import { createLocalJWKSet, decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "../db/client";
import { migrate } from "../db/schema";
import { finishCallback } from "./callback";
import { linkXanom } from "./link";
import { authorizeUrl, convertTicket, type XanomConfig } from "./oidc";
import { flowKey, newFlow, openFlow, openIosStart, s256, sealFlow, sealIosStart, STATE_TTL_MS, type Flow } from "./state";
import { buildSummary, summarySub } from "./summary";

// A fake accounts.xanom.co: an RSA key, its JWKS, and a token endpoint that checks PKCE.
const config: XanomConfig = { issuer: "https://accounts.xanom.co", clientId: "lodestar", clientSecret: "test-client-secret-value" };
const APP = "https://lodestar.xanom.co";
const NOW = Date.parse("2026-11-12T12:00:00Z");
const sec = (ms: number) => Math.floor(ms / 1000);

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let wrongKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
  wrongKey = (await generateKeyPair("RS256")).privateKey;
});

type Claims = Record<string, unknown>;
const sign = (claims: Claims, opts: { key?: CryptoKey; iat?: number; exp?: number; aud?: string; iss?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? config.issuer)
    .setAudience(opts.aud ?? config.clientId)
    .setIssuedAt(opts.iat ?? sec(NOW))
    .setExpirationTime(opts.exp ?? sec(NOW) + 600)
    .sign(opts.key ?? privateKey);

const key = flowKey("a-long-enough-test-secret");
const flowFor = (over: Partial<Flow> = {}): Flow => ({
  ...newFlow({ intent: "signin", platform: "web", returnTo: "/", userId: null, challenge: null }, NOW),
  ...over,
});

/** A token endpoint that answers with `idToken` only for the right code, verifier and client. */
function tokenEndpoint(flow: Flow, idToken: string) {
  const calls: URLSearchParams[] = [];
  const fetcher = (async (url: URL, init: RequestInit) => {
    const body = new URLSearchParams(init.body as URLSearchParams);
    calls.push(body);
    const good =
      url.toString() === "https://accounts.xanom.co/oauth/token" &&
      body.get("code") === "the-code" &&
      s256(body.get("code_verifier")!) === s256(flow.verifier) &&
      body.get("client_secret") === config.clientSecret &&
      body.get("redirect_uri") === `${APP}/api/xanom/callback`;
    return good ? Response.json({ id_token: idToken, token_type: "Bearer" }) : Response.json({ error: "invalid_grant" }, { status: 400 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const params = (p: Record<string, string>) => new URLSearchParams(p);

describe("flow state cookie", () => {
  it("round-trips, and refuses tampering, expiry and the wrong kind of token", () => {
    const flow = flowFor();
    const sealed = sealFlow(key, flow);
    expect(openFlow(key, sealed, NOW)).toEqual(flow);
    expect(openFlow(key, sealed, NOW + STATE_TTL_MS)).toBeNull();
    expect(openFlow(flowKey("another-long-test-secret"), sealed, NOW)).toBeNull();
    const [body, mac] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...flow, kind: "flow", userId: "00000000-0000-4000-8000-000000000000" })).toString("base64url");
    expect(openFlow(key, `${forged}.${mac}`, NOW)).toBeNull();
    expect(openFlow(key, `${body}.${mac}.x`, NOW)).toBeNull();
    expect(openFlow(key, undefined, NOW)).toBeNull();

    const start = sealIosStart(key, { userId: "00000000-0000-4000-8000-000000000000", intent: "link", challenge: "c".repeat(43), expiresAt: NOW + 1000 });
    expect(openIosStart(key, start, NOW)?.intent).toBe("link");
    expect(openFlow(key, start, NOW)).toBeNull();
    expect(openIosStart(key, sealed, NOW)).toBeNull();
  });

  it("each flow gets fresh state, verifier and nonce", () => {
    const a = flowFor();
    const b = flowFor();
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("authorize URL", () => {
  it("sends state, nonce, the S256 challenge and the exact redirect URI", () => {
    const flow = flowFor();
    const url = new URL(authorizeUrl(config, APP, flow, "convert.ticket.here"));
    expect(url.origin + url.pathname).toBe("https://accounts.xanom.co/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "lodestar",
      redirect_uri: "https://lodestar.xanom.co/api/xanom/callback",
      scope: "openid email profile",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: s256(flow.verifier),
      code_challenge_method: "S256",
      convert: "convert.ticket.here",
    });
  });
});

describe("callback: state, PKCE and nonce", () => {
  const good = (flow: Flow) => sign({ sub: "xa_ADA", email: "Ada@Example.com", email_verified: true, name: "Ada", nonce: flow.nonce });

  it("accepts a matching state, exchanges with the verifier and returns the identity", async () => {
    const flow = flowFor();
    const { fetcher, calls } = tokenEndpoint(flow, await good(flow));
    const r = await finishCallback({ config, appUrl: APP, params: params({ code: "the-code", state: flow.state }), flow, jwks, now: NOW, fetcher });
    expect(r).toEqual({ ok: true, identity: { sub: "xa_ADA", email: "ada@example.com", name: "Ada" } });
    expect(calls[0].get("code_verifier")).toBe(flow.verifier);
  });

  it("refuses a missing flow or a different state without calling the token endpoint", async () => {
    const flow = flowFor();
    const { fetcher, calls } = tokenEndpoint(flow, await good(flow));
    expect(await finishCallback({ config, appUrl: APP, params: params({ code: "the-code", state: flow.state }), flow: null, jwks, now: NOW, fetcher })).toMatchObject({ ok: false, reason: "expired" });
    expect(await finishCallback({ config, appUrl: APP, params: params({ code: "the-code", state: "x".repeat(43) }), flow, jwks, now: NOW, fetcher })).toMatchObject({ ok: false, reason: "expired" });
    expect(await finishCallback({ config, appUrl: APP, params: params({ code: "the-code" }), flow, jwks, now: NOW, fetcher })).toMatchObject({ ok: false, reason: "expired" });
    expect(calls).toHaveLength(0);
  });

  it("maps an error from the issuer", async () => {
    const flow = flowFor();
    const r = await finishCallback({ config, appUrl: APP, params: params({ error: "access_denied", state: flow.state }), flow, jwks, now: NOW });
    expect(r).toMatchObject({ ok: false, reason: "denied" });
  });

  it("fails when the token endpoint refuses (e.g. the verifier is wrong)", async () => {
    const flow = flowFor();
    const { fetcher } = tokenEndpoint({ ...flow, verifier: "y".repeat(64) }, await good(flow));
    expect(await finishCallback({ config, appUrl: APP, params: params({ code: "the-code", state: flow.state }), flow, jwks, now: NOW, fetcher })).toMatchObject({ ok: false, reason: "failed" });
  });

  const rejects = async (flow: Flow, token: string) => {
    const { fetcher } = tokenEndpoint(flow, token);
    return finishCallback({ config, appUrl: APP, params: params({ code: "the-code", state: flow.state }), flow, jwks, now: NOW, fetcher });
  };

  it("rejects a wrong nonce, a missing nonce, wrong aud, wrong iss, expired, a bad signature, or an unverified email", async () => {
    const flow = flowFor();
    const base = { sub: "xa_ADA", email: "ada@example.com", email_verified: true, nonce: flow.nonce };
    const bad = [
      await sign({ ...base, nonce: "other-nonce-value-xxxxxxxx" }),
      await sign({ ...base, nonce: undefined }),
      await sign(base, { aud: "mullwell" }),
      await sign(base, { iss: "https://evil.example" }),
      await sign(base, { iat: sec(NOW) - 1200, exp: sec(NOW) - 600 }),
      await sign(base, { key: wrongKey }),
      await sign({ ...base, email_verified: false }),
    ];
    for (const token of bad) expect(await rejects(flow, token)).toMatchObject({ ok: false, reason: "failed" });
  });

  it("feeds the linking rules end to end", async () => {
    const db: Db = await createPgliteDb();
    await migrate(db);
    const flow = flowFor();
    const { fetcher } = tokenEndpoint(flow, await good(flow));
    const r = await finishCallback({ config, appUrl: APP, params: params({ code: "the-code", state: flow.state }), flow, jwks, now: NOW, fetcher });
    if (!r.ok) throw new Error("callback failed");
    expect(await linkXanom(db, r.identity, { intent: "signin", currentUserId: null, now: NOW })).toMatchObject({ ok: true, created: true });
  });
});

describe("convert ticket", () => {
  it("is HS256 with the client secret and carries the spec's claims for five minutes", async () => {
    const ticket = await convertTicket(config, { email: "ada@example.com", name: "Ada", emailVerified: true }, NOW);
    expect(decodeProtectedHeader(ticket)).toEqual({ alg: "HS256", typ: "JWT" });
    const { payload } = await jwtVerify(ticket, new TextEncoder().encode(config.clientSecret), { audience: "https://accounts.xanom.co", issuer: "lodestar", currentDate: new Date(NOW) });
    expect(payload).toMatchObject({ email: "ada@example.com", name: "Ada", email_verified: true, iat: sec(NOW), exp: sec(NOW) + 300 });
    expect(typeof payload.jti).toBe("string");
    const other = await convertTicket(config, { email: "ada@example.com", name: "", emailVerified: false }, NOW);
    const second = await jwtVerify(other, new TextEncoder().encode(config.clientSecret), { currentDate: new Date(NOW) });
    expect(second.payload.jti).not.toBe(payload.jti);
    expect(second.payload.email_verified).toBe(false);
    await expect(jwtVerify(ticket, new TextEncoder().encode("a-different-secret-value"), { currentDate: new Date(NOW) })).rejects.toThrow();
  });
});

describe("summary endpoint", () => {
  const summaryToken = (over: { aud?: string; key?: CryptoKey; iat?: number; exp?: number; scope?: string } = {}) =>
    sign({ sub: "xa_ADA", scope: over.scope ?? "summary" }, { aud: over.aud, key: over.key, iat: over.iat ?? sec(NOW), exp: over.exp ?? sec(NOW) + 60 });

  it("accepts a good token and rejects wrong aud, expired, bad signature, wrong scope and no bearer", async () => {
    expect(await summarySub(config, `Bearer ${await summaryToken()}`, jwks, NOW)).toBe("xa_ADA");
    expect(await summarySub(config, `Bearer ${await summaryToken({ aud: "mullwell" })}`, jwks, NOW)).toBeNull();
    expect(await summarySub(config, `Bearer ${await summaryToken({ iat: sec(NOW) - 120, exp: sec(NOW) - 60 })}`, jwks, NOW)).toBeNull();
    expect(await summarySub(config, `Bearer ${await summaryToken({ key: wrongKey })}`, jwks, NOW)).toBeNull();
    expect(await summarySub(config, `Bearer ${await summaryToken({ scope: "openid" })}`, jwks, NOW)).toBeNull();
    expect(await summarySub(config, null, jwks, NOW)).toBeNull();
    expect(await summarySub(config, "Bearer not-a-jwt", jwks, NOW)).toBeNull();
  });

  it("answers linked: false for an unknown sub, and counts with titles only for a linked one", async () => {
    const db: Db = await createPgliteDb();
    await migrate(db);
    expect(await buildSummary(db, "xa_NOBODY", APP, NOW)).toEqual({ linked: false });
    const linked = await linkXanom(db, { sub: "xa_ADA", email: "ada@example.com", name: "Ada" }, { intent: "signin", currentUserId: null, now: NOW });
    const userId = (linked as { userId: string }).userId;
    const trip = (id: string, title: string, start: string, updated: string) =>
      db.query("INSERT INTO journeys (id, user_id, title, start_date, end_date, source, created_at, updated_at) VALUES ($1, $2, $3, $4, $4, 'manual', $5, $5)", [id, userId, title, start, updated]);
    await trip("11111111-1111-4111-8111-111111111111", "Tokyo", "2026-12-01", "2026-11-10T10:00:00Z");
    await trip("22222222-2222-4222-8222-222222222222", "Lisbon", "2026-01-05", "2026-11-11T10:00:00Z");
    const s = await buildSummary(db, "xa_ADA", APP, NOW);
    expect(s).toEqual({
      linked: true,
      headline: "1 upcoming trip · 0 fare watches",
      items: [
        { label: "Trips", value: "2" },
        { label: "Upcoming", value: "1" },
        { label: "Fare watches", value: "0" },
      ],
      recent: [
        { title: "Lisbon", url: `${APP}/?trip=22222222-2222-4222-8222-222222222222`, at: "2026-11-11T10:00:00.000Z" },
        { title: "Tokyo", url: `${APP}/?trip=11111111-1111-4111-8111-111111111111`, at: "2026-11-10T10:00:00.000Z" },
      ],
      url: `${APP}/`,
    });
  });
});

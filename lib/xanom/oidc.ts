import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { randomToken, s256, type Flow } from "./state";

// Lodestar as a confidential OIDC client of accounts.xanom.co (docs: xanom-accounts SPEC.md §2–4).

export type XanomConfig = { issuer: string; clientId: string; clientSecret: string };

/** A verified Xanom identity from an id_token. */
export type XanomIdentity = { sub: string; email: string; name: string };

export const callbackUrl = (appUrl: string): string => new URL("/api/xanom/callback", appUrl).toString();

const jwksCache = new Map<string, JWTVerifyGetKey>();

/** The issuer's signing keys, fetched lazily and kept for 10 minutes. */
export function remoteJwks(issuer: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("/oauth/jwks", issuer), { cacheMaxAge: 10 * 60_000, timeoutDuration: 1500 });
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

export type ConvertClaims = { email: string; name: string; emailVerified: boolean };

/** The §3 convert ticket: HS256 with the client secret, five minutes, single-use jti. */
export function convertTicket(config: XanomConfig, claims: ConvertClaims, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ email: claims.email, name: claims.name, email_verified: claims.emailVerified })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.clientId)
    .setAudience(config.issuer)
    .setJti(randomToken(16))
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(new TextEncoder().encode(config.clientSecret));
}

export function authorizeUrl(config: XanomConfig, appUrl: string, flow: Flow, convert: string | null): string {
  const url = new URL("/oauth/authorize", config.issuer);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: callbackUrl(appUrl),
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: s256(flow.verifier),
    code_challenge_method: "S256",
  };
  if (convert) params.convert = convert;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export class XanomError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
  }
}

/** Trades the code for tokens and returns the id_token, unverified. */
export async function exchangeCode(config: XanomConfig, appUrl: string, code: string, verifier: string, fetcher: typeof fetch = fetch): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(appUrl),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: verifier,
  });
  const res = await fetcher(new URL("/oauth/token", config.issuer), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof json?.id_token !== "string") throw new XanomError("failed", `token endpoint answered ${res.status} ${typeof json?.error === "string" ? json.error : ""}`.trim());
  return json.id_token;
}

/** Checks signature, iss, aud, exp and nonce, and that Xanom vouches for the email. */
export async function verifyIdToken(config: XanomConfig, idToken: string, nonce: string, jwks: JWTVerifyGetKey, now: number): Promise<XanomIdentity> {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: config.issuer,
    audience: config.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat", "email"],
    currentDate: new Date(now),
  }).catch((err: unknown) => {
    throw new XanomError("failed", `id_token rejected: ${err instanceof Error ? err.message : "unknown"}`);
  });
  if (payload.nonce !== nonce) throw new XanomError("failed", "id_token nonce mismatch");
  if (payload.email_verified !== true) throw new XanomError("failed", "id_token email not verified");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !email.includes("@")) throw new XanomError("failed", "id_token has no usable email");
  const sub = payload.sub!;
  if (sub.length > 100) throw new XanomError("failed", "id_token sub too long");
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 60) : "";
  return { sub, email, name };
}

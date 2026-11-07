import { beforeEach, describe, expect, it } from "vitest";
import { ACCESS_TTL_MS, CODE_TTL_MS, hashToken } from "../oauth/tokens";
import { createPersonalToken, grantOAuth, issueCode, listGrants, refreshGrant, revokeGrant, takeCode, tokenOwner } from "./agent-auth";
import { createPgliteDb, type Db } from "./client";
import { migrate } from "./schema";
import { insertUser } from "./users";

let db: Db;
const ada = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const claude = { id: "https://claude.ai/oauth/claude-code-client-metadata", name: "Claude Code" };
const T0 = 1_800_000_000_000;

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: ada, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
  await insertUser(db, { id: bob, email: "bob@example.com", passwordHash: "x", createdAt: 1 });
});

describe("authorization codes", () => {
  const grant = { userId: ada, clientId: claude.id, redirectUri: "https://claude.ai/cb", challenge: "c".repeat(43), resource: null };

  it("work once, and are stored only as a hash", async () => {
    const code = await issueCode(db, grant, T0);
    const [row] = await db.query<{ code_hash: string }>("SELECT code_hash FROM oauth_codes");
    expect(row.code_hash).toBe(hashToken(code));
    expect(await takeCode(db, code, T0 + 1000)).toEqual(grant);
    expect(await takeCode(db, code, T0 + 2000)).toBeNull();
  });

  it("expire after ten minutes", async () => {
    const code = await issueCode(db, grant, T0);
    expect(await takeCode(db, code, T0 + CODE_TTL_MS + 1)).toBeNull();
  });
});

describe("tokens", () => {
  it("act for the account until the access token expires", async () => {
    const pair = await grantOAuth(db, ada, claude, T0);
    expect(await tokenOwner(db, pair.accessToken, T0 + 1000)).toMatchObject({ userId: ada, clientId: claude.id, expiresAt: T0 + ACCESS_TTL_MS });
    expect(await tokenOwner(db, pair.accessToken, T0 + ACCESS_TTL_MS + 1)).toBeNull();
    // A refresh token is not an access token.
    expect(await tokenOwner(db, pair.refreshToken, T0)).toBeNull();
    const stored = await db.query<{ token_hash: string }>("SELECT token_hash FROM agent_tokens");
    expect(stored.map((r) => r.token_hash)).not.toContain(pair.accessToken);
  });

  it("keep one connection per app per account, and record when it was last used", async () => {
    await grantOAuth(db, ada, claude, T0);
    const second = await grantOAuth(db, ada, claude, T0 + 5000);
    await tokenOwner(db, second.accessToken, T0 + 6000);
    const grants = await listGrants(db, ada);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ kind: "oauth", name: "Claude Code", lastUsedAt: T0 + 6000 });
    expect(await listGrants(db, bob)).toEqual([]);
  });

  it("rotate on refresh, and a reused refresh token revokes the connection", async () => {
    const first = await grantOAuth(db, ada, claude, T0);
    const r = await refreshGrant(db, first.refreshToken, claude.id, T0 + 1000);
    expect(r.ok).toBe(true);
    const next = (r as { pair: { accessToken: string; refreshToken: string } }).pair;
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect(await tokenOwner(db, next.accessToken, T0 + 2000)).not.toBeNull();

    expect(await refreshGrant(db, first.refreshToken, claude.id, T0 + 3000)).toEqual({ ok: false, reason: "reused" });
    expect(await tokenOwner(db, next.accessToken, T0 + 4000)).toBeNull();
    expect(await listGrants(db, ada)).toEqual([]);
  });

  it("refuse a refresh token from another client or past its expiry", async () => {
    const pair = await grantOAuth(db, ada, claude, T0);
    expect(await refreshGrant(db, pair.refreshToken, "someone-else", T0)).toEqual({ ok: false, reason: "invalid" });
    expect(await refreshGrant(db, pair.refreshToken, claude.id, T0 + 31 * 24 * 3600 * 1000)).toEqual({ ok: false, reason: "invalid" });
  });

  it("personal tokens never expire and stop working when revoked, by their owner only", async () => {
    const { grant, token } = await createPersonalToken(db, ada, "Codex", T0);
    expect(token).toMatch(/^lsp_/);
    expect(await tokenOwner(db, token, T0 + 400 * 24 * 3600 * 1000)).toMatchObject({ userId: ada, expiresAt: null });
    expect(await revokeGrant(db, bob, grant.id)).toBe(false);
    expect(await revokeGrant(db, ada, grant.id)).toBe(true);
    expect(await tokenOwner(db, token, T0)).toBeNull();
  });
});

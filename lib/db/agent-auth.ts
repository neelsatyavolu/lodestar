import { randomUUID } from "node:crypto";
import { ACCESS_TTL_MS, CODE_TTL_MS, hashToken, newToken, REFRESH_TTL_MS } from "../oauth/tokens";
import type { Queryable, Row } from "./client";
import { toTs } from "./time";

// Agent access: OAuth clients, authorization codes, and the grants and tokens
// that let an agent act for one account. Tokens and codes are stored only as
// SHA-256 hashes; every lookup goes through the hash.

export const MAX_GRANTS = 50;
const ms = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string).getTime());

// ---------- Clients ----------

export type ClientKind = "dcr" | "cimd";
export type OAuthClient = { id: string; name: string; redirectUris: string[]; kind: ClientKind; fetchedAt: number | null };

const toClient = (r: Row): OAuthClient => ({ id: r.id as string, name: r.name as string, redirectUris: r.redirect_uris as string[], kind: r.kind as ClientKind, fetchedAt: ms(r.fetched_at) });

export async function getClient(q: Queryable, id: string): Promise<OAuthClient | null> {
  const [row] = await q.query("SELECT * FROM oauth_clients WHERE id = $1", [id]);
  return row ? toClient(row) : null;
}

/** Saves a registered client, or refreshes a cached metadata document. */
export async function putClient(q: Queryable, c: { id: string; name: string; redirectUris: string[]; kind: ClientKind }, now: number): Promise<OAuthClient> {
  const [row] = await q.query(
    `INSERT INTO oauth_clients (id, name, redirect_uris, kind, created_at, fetched_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris, fetched_at = EXCLUDED.fetched_at
     RETURNING *`,
    [c.id, c.name, JSON.stringify(c.redirectUris), c.kind, toTs(now), c.kind === "cimd" ? toTs(now) : null],
  );
  return toClient(row);
}

// ---------- Authorization codes ----------

export type CodeGrant = { userId: string; clientId: string; redirectUri: string; challenge: string; resource: string | null };

/** Issues a single-use code for an approved request. Returns the code itself; only its hash is stored. */
export async function issueCode(q: Queryable, g: CodeGrant, now: number): Promise<string> {
  const code = newToken("code");
  await q.query("DELETE FROM oauth_codes WHERE expires_at < $1", [toTs(now)]);
  await q.query("INSERT INTO oauth_codes (code_hash, user_id, client_id, redirect_uri, challenge, resource, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    hashToken(code), g.userId, g.clientId, g.redirectUri, g.challenge, g.resource, toTs(now + CODE_TTL_MS),
  ]);
  return code;
}

/** Takes a code: it's deleted whether or not it was still valid, so it can never be used twice. */
export async function takeCode(q: Queryable, code: string, now: number): Promise<CodeGrant | null> {
  const [row] = await q.query("DELETE FROM oauth_codes WHERE code_hash = $1 RETURNING *", [hashToken(code)]);
  if (!row || ms(row.expires_at)! <= now) return null;
  return { userId: row.user_id as string, clientId: row.client_id as string, redirectUri: row.redirect_uri as string, challenge: row.challenge as string, resource: (row.resource as string | null) ?? null };
}

// ---------- Grants and tokens ----------

export type Grant = { id: string; kind: "oauth" | "personal"; clientId: string | null; name: string; createdAt: number; lastUsedAt: number | null };
const toGrant = (r: Row): Grant => ({ id: r.id as string, kind: r.kind as Grant["kind"], clientId: (r.client_id as string | null) ?? null, name: r.name as string, createdAt: ms(r.created_at)!, lastUsedAt: ms(r.last_used_at) });

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };

async function insertToken(q: Queryable, grantId: string, userId: string, kind: "access" | "refresh" | "personal", token: string, expiresAt: number | null, now: number): Promise<void> {
  await q.query("INSERT INTO agent_tokens (token_hash, grant_id, user_id, kind, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    hashToken(token), grantId, userId, kind, expiresAt === null ? null : toTs(expiresAt), toTs(now),
  ]);
}

async function issuePair(q: Queryable, grantId: string, userId: string, now: number): Promise<TokenPair> {
  const accessToken = newToken("access");
  const refreshToken = newToken("refresh");
  await q.query("DELETE FROM agent_tokens WHERE grant_id = $1 AND expires_at < $2", [grantId, toTs(now)]);
  await insertToken(q, grantId, userId, "access", accessToken, now + ACCESS_TTL_MS, now);
  await insertToken(q, grantId, userId, "refresh", refreshToken, now + REFRESH_TTL_MS, now);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000 };
}

/** Exchanging a code: the app's grant for this account (made on first connect) gets a new token pair. */
export async function grantOAuth(q: Queryable, userId: string, client: { id: string; name: string }, now: number): Promise<TokenPair> {
  const [row] = await q.query<{ id: string }>(
    `INSERT INTO agent_grants (id, user_id, kind, client_id, name, created_at) VALUES ($1, $2, 'oauth', $3, $4, $5)
     ON CONFLICT (user_id, client_id) WHERE kind = 'oauth' DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [randomUUID(), userId, client.id, client.name, toTs(now)],
  );
  return issuePair(q, row.id, userId, now);
}

export type RefreshResult = { ok: true; pair: TokenPair; clientId: string } | { ok: false; reason: "invalid" | "reused" };

/**
 * Rotates a refresh token. A refresh token is good once: presenting one that
 * was already rotated means it leaked, so the whole grant is revoked.
 */
export async function refreshGrant(q: Queryable, refreshToken: string, clientId: string, now: number): Promise<RefreshResult> {
  const [row] = await q.query(
    `SELECT t.*, g.client_id FROM agent_tokens t JOIN agent_grants g ON g.id = t.grant_id WHERE t.token_hash = $1 AND t.kind = 'refresh'`,
    [hashToken(refreshToken)],
  );
  if (!row || row.client_id !== clientId || ms(row.expires_at)! <= now) return { ok: false, reason: "invalid" };
  if (row.used_at) {
    await q.query("DELETE FROM agent_grants WHERE id = $1", [row.grant_id]);
    return { ok: false, reason: "reused" };
  }
  const [claimed] = await q.query("UPDATE agent_tokens SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL RETURNING grant_id", [row.token_hash, toTs(now)]);
  if (!claimed) {
    await q.query("DELETE FROM agent_grants WHERE id = $1", [row.grant_id]);
    return { ok: false, reason: "reused" };
  }
  return { ok: true, pair: await issuePair(q, row.grant_id as string, row.user_id as string, now), clientId };
}

/** A named personal token for a CLI or script. Returns the token; it's never shown again. */
export async function createPersonalToken(q: Queryable, userId: string, name: string, now: number): Promise<{ grant: Grant; token: string }> {
  const id = randomUUID();
  const [row] = await q.query("INSERT INTO agent_grants (id, user_id, kind, client_id, name, created_at) VALUES ($1, $2, 'personal', NULL, $3, $4) RETURNING *", [id, userId, name, toTs(now)]);
  const token = newToken("personal");
  await insertToken(q, id, userId, "personal", token, null, now);
  return { grant: toGrant(row), token };
}

export type TokenOwner = { userId: string; grantId: string; clientId: string; expiresAt: number | null };

/** Who an access or personal token acts for, or null if it's unknown, expired or revoked. Marks the grant used. */
export async function tokenOwner(q: Queryable, token: string, now: number): Promise<TokenOwner | null> {
  const [row] = await q.query(
    `SELECT t.user_id, t.grant_id, t.expires_at, g.client_id, g.kind AS grant_kind, g.last_used_at FROM agent_tokens t JOIN agent_grants g ON g.id = t.grant_id
     WHERE t.token_hash = $1 AND t.kind IN ('access', 'personal')`,
    [hashToken(token)],
  );
  if (!row) return null;
  const expiresAt = ms(row.expires_at);
  if (expiresAt !== null && expiresAt <= now) return null;
  // One write a minute is plenty for "last used".
  const last = ms(row.last_used_at);
  if (last === null || now - last > 60_000) await q.query("UPDATE agent_grants SET last_used_at = $2 WHERE id = $1", [row.grant_id, toTs(now)]);
  return { userId: row.user_id as string, grantId: row.grant_id as string, clientId: (row.client_id as string | null) ?? `personal:${row.grant_id}`, expiresAt };
}

export async function listGrants(q: Queryable, userId: string): Promise<Grant[]> {
  return (await q.query("SELECT * FROM agent_grants WHERE user_id = $1 ORDER BY created_at DESC", [userId])).map(toGrant);
}

export async function countGrants(q: Queryable, userId: string): Promise<number> {
  const [row] = await q.query<{ n: string | number }>("SELECT count(*) AS n FROM agent_grants WHERE user_id = $1", [userId]);
  return Number(row?.n ?? 0);
}

/** Disconnects an app or deletes a personal token, and every token under it. */
export async function revokeGrant(q: Queryable, userId: string, grantId: string): Promise<boolean> {
  return (await q.query("DELETE FROM agent_grants WHERE id = $1 AND user_id = $2 RETURNING id", [grantId, userId])).length > 0;
}

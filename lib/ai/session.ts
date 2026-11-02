import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { type Provider, type Tokens, refreshTokens } from "./providers";
import { deriveKey, seal, unseal } from "./seal";

// Contrail has no accounts. A random device id in an httpOnly cookie is the
// owner of this browser's AI connection. Provider tokens live only in this
// browser's cookies, encrypted (AES-GCM) and bound to that device id; the
// server stores nothing. Cookies are scoped to /api/ai so pages never carry them.

const SESSION_TTL_DAYS = 30;
const PKCE_TTL_SECONDS = 10 * 60;
const CHUNK_SIZE = 3500;
const MAX_CHUNKS = 6;
const COOKIE_PATH = "/api/ai";
const DEVICE_COOKIE = "ct_device";

const sessionPrefix = (p: Provider) => `${p}_s`;
const pkceCookie = (p: Provider) => `${p}_pkce`;

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: COOKIE_PATH,
  maxAge,
});

let cachedKey: Buffer | null = null;
function key(): Buffer {
  const secret = process.env.CONTRAIL_SECRET;
  if (!secret) throw new Error("CONTRAIL_SECRET is not set");
  cachedKey ??= deriveKey(secret, "ai-session-cookies");
  return cachedKey;
}

/** This browser's device id, created on first use. */
export async function deviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
  const id = randomUUID();
  jar.set(DEVICE_COOKIE, id, { ...cookieOptions(365 * 24 * 60 * 60) });
  return id;
}

type PkceCookie = { verifier: string; state: string };

export async function writePkce(provider: Provider, value: PkceCookie): Promise<void> {
  const jar = await cookies();
  jar.set(pkceCookie(provider), seal(key(), JSON.stringify(value), `${provider}:pkce`), cookieOptions(PKCE_TTL_SECONDS));
}

export async function readPkce(provider: Provider): Promise<PkceCookie | null> {
  const jar = await cookies();
  const sealed = jar.get(pkceCookie(provider))?.value;
  const raw = sealed ? unseal(key(), sealed, `${provider}:pkce`) : null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.verifier === "string" && typeof parsed.state === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearPkce(provider: Provider): Promise<void> {
  (await cookies()).delete({ name: pkceCookie(provider), path: COOKIE_PATH });
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

type StoredSession = Tokens & { owner: string };
const sessionAad = (provider: Provider, owner: string) => `${provider}:${owner}`;

export async function writeSession(provider: Provider, owner: string, tokens: Tokens): Promise<void> {
  const json = JSON.stringify({ ...tokens, owner } satisfies StoredSession);
  const chunks = chunkString(seal(key(), json, sessionAad(provider, owner)), CHUNK_SIZE);
  if (chunks.length > MAX_CHUNKS) throw new Error(`${provider} session too large to fit in ${MAX_CHUNKS} cookies.`);
  const jar = await cookies();
  const opts = cookieOptions(SESSION_TTL_DAYS * 24 * 60 * 60);
  const prefix = sessionPrefix(provider);
  chunks.forEach((chunk, i) => jar.set(`${prefix}_${i}`, chunk, opts));
  for (let i = chunks.length; i < MAX_CHUNKS; i++) jar.delete({ name: `${prefix}_${i}`, path: COOKIE_PATH });
}

export async function clearSession(provider: Provider): Promise<void> {
  const jar = await cookies();
  const prefix = sessionPrefix(provider);
  for (let i = 0; i < MAX_CHUNKS; i++) jar.delete({ name: `${prefix}_${i}`, path: COOKIE_PATH });
}

async function readSessionRaw(provider: Provider, owner: string): Promise<Tokens | null> {
  const jar = await cookies();
  let sealed = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const v = jar.get(`${sessionPrefix(provider)}_${i}`)?.value;
    if (!v) break;
    sealed += v;
  }
  const joined = sealed ? unseal(key(), sealed, sessionAad(provider, owner)) : null;
  if (!joined) return null;
  try {
    const parsed = JSON.parse(joined) as Partial<StoredSession>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string" || parsed.owner !== owner) return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: Number(parsed.expiresAt), idToken: parsed.idToken, accountId: parsed.accountId };
  } catch {
    return null;
  }
}

export async function hasSession(provider: Provider, owner: string): Promise<boolean> {
  return (await readSessionRaw(provider, owner)) !== null;
}

// Providers rotate refresh tokens, so concurrent requests near expiry share one refresh.
const REFRESH_REUSE_MS = 2 * 60_000;
const refreshes = new Map<string, { at: number; result: Promise<Tokens> }>();

function sharedRefresh(provider: Provider, session: Tokens): Promise<Tokens> {
  const now = Date.now();
  for (const [k, v] of refreshes) if (now - v.at > REFRESH_REUSE_MS) refreshes.delete(k);
  const k = `${provider}:${session.refreshToken}`;
  const existing = refreshes.get(k);
  if (existing) return existing.result;
  const result = refreshTokens(provider, session.refreshToken, session);
  refreshes.set(k, { at: now, result });
  result.catch(() => refreshes.delete(k));
  return result;
}

/** A valid token, refreshed (and re-persisted) when near expiry. */
export async function getActiveSession(provider: Provider, owner: string): Promise<Tokens | null> {
  const session = await readSessionRaw(provider, owner);
  if (!session) return null;
  if (session.expiresAt > Date.now() + 30_000) return session;
  try {
    const refreshed = await sharedRefresh(provider, session);
    await writeSession(provider, owner, refreshed);
    return refreshed;
  } catch (err) {
    console.error(`[ai-session] ${provider} refresh failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

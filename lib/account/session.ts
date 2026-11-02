import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Signed session tokens: "<userId>.<expiresAt>.<version>.<mac>". The version
// is the account's session version when the token was made; a password reset
// or "sign out everywhere" raises it and so ends every older session.

export const SESSION_COOKIE = "ls_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^\d{1,9}$/;

export const sessionKey = (secret: string): Buffer => Buffer.from(hkdfSync("sha256", secret, "lodestar", "session-signing", 32));

const mac = (key: Buffer, value: string) => createHmac("sha256", key).update(value).digest("base64url");

export function createSession(key: Buffer, userId: string, now: number, version: number): string {
  const value = `${userId}.${now + SESSION_TTL_MS}.${version}`;
  return `${value}.${mac(key, value)}`;
}

export type Session = { userId: string; version: number };

/** What a token says, or null if it is forged, expired or malformed. Whether the account still honours it is a database question. */
export function readSession(key: Buffer, token: string | undefined, now: number): Session | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, expires, version, given] = parts;
  const expected = Buffer.from(mac(key, `${userId}.${expires}.${version}`));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  if (!UUID.test(userId) || !VERSION.test(version) || !(now < Number(expires))) return null;
  return { userId, version: Number(version) };
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Opaque bearer tokens for agents. 32 random bytes with a prefix that says
// what the token is (so a leaked one is recognisable in logs and scanners);
// only a SHA-256 hash is ever stored.

export const PREFIX = { access: "lsa_", refresh: "lsr_", personal: "lsp_", code: "lsc_" } as const;
export type TokenKind = keyof typeof PREFIX;

export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;

export const newToken = (kind: TokenKind): string => `${PREFIX[kind]}${randomBytes(32).toString("base64url")}`;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** The kind a token claims by its prefix, or null for anything that isn't one of ours. */
export function kindOf(token: string): TokenKind | null {
  if (token.length > 100) return null;
  for (const [kind, prefix] of Object.entries(PREFIX)) if (token.startsWith(prefix) && /^[\w-]{43}$/.test(token.slice(prefix.length))) return kind as TokenKind;
  return null;
}

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const isChallenge = (c: string) => CHALLENGE.test(c);

/** PKCE S256 (RFC 7636): base64url(SHA-256(verifier)) must equal the challenge sent with the authorization request. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

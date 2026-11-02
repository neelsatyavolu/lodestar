import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Authenticated encryption (AES-256-GCM) for values kept in cookies, so
// provider tokens are unreadable and tamper-proof outside the server. The key
// is derived from a server secret with HKDF under its own label.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function deriveKey(secret: string, label: string): Buffer {
  if (secret.length < 16) throw new Error("Cookie secret is too short.");
  return Buffer.from(hkdfSync("sha256", secret, "contrail", label, 32));
}

export function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** The plaintext, or null when the value is malformed, tampered with, or sealed for another context. */
export function unseal(key: Buffer, sealed: string, aad: string): string | null {
  if (!sealed.startsWith(`${VERSION}.`)) return null;
  const raw = Buffer.from(sealed.slice(VERSION.length + 1), "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

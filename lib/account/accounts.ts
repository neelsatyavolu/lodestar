import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import { deleteExpiredResets, deleteResetsFor, insertReset, takeReset } from "../db/password-resets";
import { findUserByEmail, insertUser, replacePassword, sessionVersionOf } from "../db/users";
import { hashPassword, verifyPassword } from "./password";
import { readSession } from "./session";

export const RESET_TTL_MS = 60 * 60_000;

/** Creates an account. Its id, or null when the email is taken. */
export async function register(q: Queryable, input: { email: string; password: string; now: number }): Promise<string | null> {
  const id = randomUUID();
  const created = await insertUser(q, { id, email: input.email, passwordHash: await hashPassword(input.password), createdAt: input.now });
  return created ? id : null;
}

/** The account's id when the password is right. */
export async function signIn(q: Queryable, input: { email: string; password: string }): Promise<string | null> {
  const user = await findUserByEmail(q, input.email);
  if (!user) {
    // Spend the same time as a real check, so response time doesn't reveal who has an account.
    await verifyPassword(input.password, DUMMY_HASH);
    return null;
  }
  return (await verifyPassword(input.password, user.passwordHash)) ? user.id : null;
}

const DUMMY_HASH = "scrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** The account a session token is live for: signed, unexpired, and not ended since. */
export async function accountIn(q: Queryable, key: Buffer, token: string | undefined, now: number): Promise<string | null> {
  const session = readSession(key, token, now);
  if (!session) return null;
  return (await sessionVersionOf(q, session.userId)) === session.version ? session.userId : null;
}

// The token is random and long, so a plain hash keeps a copy of the table from being usable.
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** A one-hour reset token replacing any sent before. Only its hash is stored. */
export async function issueReset(db: Db, userId: string, now: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await deleteExpiredResets(tx, now);
    await deleteResetsFor(tx, userId);
    await insertReset(tx, { tokenHash: hashToken(token), userId, expiresAt: now + RESET_TTL_MS, createdAt: now });
  });
  return token;
}

/** Sets a new password with a reset token and ends every session. The account id, or null for a dead link. */
export async function resetPassword(db: Db, input: { token: string; password: string; now: number }): Promise<string | null> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const userId = await takeReset(tx, hashToken(input.token), input.now);
    if (!userId) return null;
    await replacePassword(tx, userId, passwordHash);
    await deleteResetsFor(tx, userId);
    return userId;
  });
}

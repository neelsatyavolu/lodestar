import type { Queryable, Row } from "./client";
import { toTs } from "./time";

export type User = { id: string; email: string; passwordHash: string; createdAt: number };

const rowToUser = (row: Row): User => ({
  id: row.id as string,
  email: row.email as string,
  passwordHash: row.password_hash as string,
  createdAt: new Date(row.created_at as string).getTime(),
});

/** False when the email already belongs to an account. */
export async function insertUser(q: Queryable, user: User): Promise<boolean> {
  const rows = await q.query(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id",
    [user.id, user.email, user.passwordHash, toTs(user.createdAt)],
  );
  return rows.length === 1;
}

export async function findUserByEmail(q: Queryable, email: string): Promise<User | null> {
  const [row] = await q.query("SELECT * FROM users WHERE email = $1", [email]);
  return row ? rowToUser(row) : null;
}

export async function getUser(q: Queryable, id: string): Promise<User | null> {
  const [row] = await q.query("SELECT * FROM users WHERE id = $1", [id]);
  return row ? rowToUser(row) : null;
}

/** The version a session must carry to still count, or null when there is no such account. */
export async function sessionVersionOf(q: Queryable, id: string): Promise<number | null> {
  const [row] = await q.query<{ session_version: number }>("SELECT session_version FROM users WHERE id = $1", [id]);
  return row?.session_version ?? null;
}

/** Stores a new password and ends every session made under the old one. */
export async function replacePassword(q: Queryable, id: string, passwordHash: string): Promise<void> {
  await q.query("UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1", [id, passwordHash]);
}

/** Ends every session the account has, everywhere. */
export async function endSessions(q: Queryable, id: string): Promise<void> {
  await q.query("UPDATE users SET session_version = session_version + 1 WHERE id = $1", [id]);
}

/** Deletes the account; its resets and preferences go with it (ON DELETE CASCADE). */
export async function deleteUser(q: Queryable, id: string): Promise<void> {
  await q.query("DELETE FROM users WHERE id = $1", [id]);
}

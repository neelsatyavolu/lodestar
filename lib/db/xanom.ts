import { createHash } from "node:crypto";
import type { Queryable, Row } from "./client";
import { toTs } from "./time";

/** The account linked to a Xanom sub, or null. */
export async function userIdForXanomSub(q: Queryable, sub: string): Promise<string | null> {
  const [row] = await q.query<{ id: string }>("SELECT id FROM users WHERE xanom_sub = $1", [sub]);
  return row?.id ?? null;
}

/**
 * Links the account to a Xanom account, unless it is already linked to a different one (false).
 * Xanom has proven `email`, so if it is the account's own, it is now verified.
 */
export async function attachXanom(q: Queryable, userId: string, sub: string, email: string): Promise<boolean> {
  const rows = await q.query(
    `UPDATE users SET xanom_sub = $2, xanom_email = $3,
       email_verified_at = CASE WHEN email = $3 THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END
     WHERE id = $1 AND (xanom_sub IS NULL OR xanom_sub = $2) RETURNING id`,
    [userId, sub, email],
  );
  return rows.length === 1;
}

/** Holds the account's row until the transaction ends, so two links can't race on it. */
export async function lockUser(q: Queryable, userId: string): Promise<void> {
  await q.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
}

/** Keeps the shown Xanom address current after each Xanom sign-in. */
export async function refreshXanomEmail(q: Queryable, userId: string, email: string): Promise<void> {
  await q.query("UPDATE users SET xanom_email = $2 WHERE id = $1 AND xanom_sub IS NOT NULL", [userId, email]);
}

export async function insertXanomUser(q: Queryable, u: { id: string; email: string; sub: string; now: number }): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO users (id, email, password_hash, xanom_sub, xanom_email, email_verified_at, created_at)
     VALUES ($1, $2, NULL, $3, $2, $4, $4) ON CONFLICT DO NOTHING RETURNING id`,
    [u.id, u.email, u.sub, toTs(u.now)],
  );
  return rows.length === 1;
}

/**
 * The pre-hijacking guard (spec §2 rule 3): someone may have registered this address without
 * owning it. Drop the password and everything that lets them back in or keeps a hand in the
 * account: sessions, reset links, connected agents, pending OAuth codes, AI sign-ins, Flint
 * pairings, the forwarding address (a new one is made on demand) and trip shares.
 */
export async function revokeAccess(q: Queryable, userId: string): Promise<void> {
  await q.query("UPDATE users SET password_hash = NULL, session_version = session_version + 1 WHERE id = $1", [userId]);
  await q.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
  await q.query("DELETE FROM agent_grants WHERE user_id = $1", [userId]);
  await q.query("DELETE FROM oauth_codes WHERE user_id = $1", [userId]);
  await q.query("DELETE FROM ai_connections WHERE user_id = $1", [userId]);
  await q.query("DELETE FROM connector_links WHERE user_id = $1", [userId]);
  await q.query("DELETE FROM connector_codes WHERE user_id = $1", [userId]);
  await q.query("DELETE FROM journey_inboxes WHERE user_id = $1", [userId]);
  await q.query("DELETE FROM journey_members WHERE journey_id IN (SELECT id FROM journeys WHERE user_id = $1)", [userId]);
  await q.query("UPDATE journeys SET share_token = NULL WHERE user_id = $1", [userId]);
}

const hashTicket = (ticket: string): string => createHash("sha256").update(ticket).digest("hex");

export type IosTicket = { sub: string; email: string; name: string; intent: string; userId: string | null; challenge: string };

export async function insertIosTicket(q: Queryable, ticket: string, t: IosTicket, expiresAt: number): Promise<void> {
  await q.query("DELETE FROM xanom_tickets WHERE expires_at <= now()");
  await q.query(
    "INSERT INTO xanom_tickets (ticket_hash, sub, email, name, intent, user_id, challenge, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [hashTicket(ticket), t.sub, t.email, t.name, t.intent, t.userId, t.challenge, toTs(expiresAt)],
  );
}

/** Uses a ticket up in one statement, so it can't be redeemed twice. Null when unknown or expired. */
export async function takeIosTicket(q: Queryable, ticket: string, now: number): Promise<IosTicket | null> {
  const [row] = await q.query<Row>("DELETE FROM xanom_tickets WHERE ticket_hash = $1 AND expires_at > $2 RETURNING *", [hashTicket(ticket), toTs(now)]);
  if (!row) return null;
  return {
    sub: row.sub as string,
    email: row.email as string,
    name: row.name as string,
    intent: row.intent as string,
    userId: (row.user_id as string | null) ?? null,
    challenge: row.challenge as string,
  };
}

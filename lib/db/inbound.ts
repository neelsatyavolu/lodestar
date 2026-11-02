import type { Queryable } from "./client";
import { toTs } from "./time";

// Mail that arrived for the trip organizer (forwarded, or pushed by Flint),
// each account's private forwarding address, and Flint pairings.

export type MailState = "parsed" | "needs_ai" | "failed" | "ignored";
export type PendingMail = { id: string; sender: string; subject: string; body: string; receivedAt: number };

/** Records a message. Null when it was already recorded (same Message-ID from Flint and a forward). */
export async function insertMail(q: Queryable, userId: string, m: { id: string; source: "forward" | "flint"; messageId: string; sender: string; subject: string; now: number }): Promise<string | null> {
  const rows = await q.query<{ id: string }>(
    `INSERT INTO inbound_mail (id, user_id, source, message_id, sender, subject, state, received_at) VALUES ($1, $2, $3, $4, $5, $6, 'parsed', $7)
     ON CONFLICT (user_id, message_id) DO NOTHING RETURNING id`,
    [m.id, userId, m.source, m.messageId.slice(0, 500), m.sender.slice(0, 300), m.subject.slice(0, 300), toTs(m.now)],
  );
  return rows[0]?.id ?? null;
}

/** Sets the outcome. The body is kept only while the message waits to be read. */
export async function setMailState(q: Queryable, userId: string, id: string, state: MailState, body: string | null = null, error: string | null = null): Promise<void> {
  await q.query("UPDATE inbound_mail SET state = $3, body = $4, error = $5 WHERE id = $1 AND user_id = $2", [id, userId, state, state === "needs_ai" ? body : null, error]);
}

export async function pendingMail(q: Queryable, userId: string, limit: number): Promise<PendingMail[]> {
  const rows = await q.query<{ id: string; sender: string; subject: string; body: string; received_at: string }>(
    "SELECT id, sender, subject, body, received_at FROM inbound_mail WHERE user_id = $1 AND state = 'needs_ai' AND body IS NOT NULL ORDER BY received_at LIMIT $2",
    [userId, limit],
  );
  return rows.map((r) => ({ id: r.id, sender: r.sender, subject: r.subject, body: r.body, receivedAt: new Date(r.received_at).getTime() }));
}

export type MailSummary = { id: string; sender: string; subject: string; state: MailState; error: string | null; receivedAt: number };

/** Messages waiting to be read or that failed, newest first, for the Trips page. */
export async function mailNeedingAttention(q: Queryable, userId: string): Promise<MailSummary[]> {
  const rows = await q.query<{ id: string; sender: string; subject: string; state: MailState; error: string | null; received_at: string }>(
    "SELECT id, sender, subject, state, error, received_at FROM inbound_mail WHERE user_id = $1 AND state IN ('needs_ai', 'failed') ORDER BY received_at DESC LIMIT 50",
    [userId],
  );
  return rows.map((r) => ({ id: r.id, sender: r.sender, subject: r.subject, state: r.state, error: r.error, receivedAt: new Date(r.received_at).getTime() }));
}

export async function deleteMail(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query("DELETE FROM inbound_mail WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
}

/** Drops bodies nobody read within the retention window (run by the daily cron). */
export async function purgeStaleBodies(q: Queryable, before: number): Promise<number> {
  const rows = await q.query("UPDATE inbound_mail SET body = NULL, state = 'failed', error = 'Not read within 30 days.' WHERE body IS NOT NULL AND received_at < $1 RETURNING id", [toTs(before)]);
  return rows.length;
}

// ---------- Forwarding address ----------

export async function inboxToken(q: Queryable, userId: string): Promise<string | null> {
  const [row] = await q.query<{ token: string }>("SELECT token FROM journey_inboxes WHERE user_id = $1", [userId]);
  return row?.token ?? null;
}

/** Sets (or replaces, making the old address stop working) the account's forwarding token. */
export async function setInboxToken(q: Queryable, userId: string, token: string): Promise<void> {
  await q.query("INSERT INTO journey_inboxes (user_id, token) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token", [userId, token]);
}

/** The account's token, creating it with `candidate` if it has none. Safe when two requests race: both get the winner. */
export async function ensureInboxToken(q: Queryable, userId: string, candidate: string): Promise<string> {
  await q.query("INSERT INTO journey_inboxes (user_id, token) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, candidate]);
  return (await inboxToken(q, userId))!;
}

export async function userForInbox(q: Queryable, token: string): Promise<string | null> {
  const [row] = await q.query<{ user_id: string }>("SELECT user_id FROM journey_inboxes WHERE token = $1", [token]);
  return row?.user_id ?? null;
}

// ---------- Flint pairing ----------

export async function insertPairCode(q: Queryable, userId: string, codeHash: string, expiresAt: number): Promise<void> {
  await q.query("DELETE FROM connector_codes WHERE user_id = $1", [userId]);
  await q.query("INSERT INTO connector_codes (code_hash, user_id, expires_at) VALUES ($1, $2, $3)", [codeHash, userId, toTs(expiresAt)]);
}

/** Uses up a pairing code. The account it was issued to, or null when it's unknown or expired. */
export async function takePairCode(q: Queryable, codeHash: string, now: number): Promise<string | null> {
  const [row] = await q.query<{ user_id: string; expires_at: string }>("DELETE FROM connector_codes WHERE code_hash = $1 RETURNING user_id, expires_at", [codeHash]);
  if (!row || new Date(row.expires_at).getTime() < now) return null;
  return row.user_id;
}

export type ConnectorLink = { id: string; deviceName: string; createdAt: number; lastDeliveryAt: number | null };

export async function insertLink(q: Queryable, userId: string, l: { id: string; sealedSecret: string; deviceName: string; now: number }): Promise<boolean> {
  const rows = await q.query("INSERT INTO connector_links (id, user_id, sealed_secret, device_name, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING RETURNING id", [l.id, userId, l.sealedSecret, l.deviceName.slice(0, 80), toTs(l.now)]);
  return rows.length > 0;
}

export async function linkSecret(q: Queryable, id: string): Promise<{ userId: string; sealedSecret: string } | null> {
  const [row] = await q.query<{ user_id: string; sealed_secret: string }>("SELECT user_id, sealed_secret FROM connector_links WHERE id = $1", [id]);
  return row ? { userId: row.user_id, sealedSecret: row.sealed_secret } : null;
}

export async function touchLink(q: Queryable, id: string, now: number): Promise<void> {
  await q.query("UPDATE connector_links SET last_delivery_at = $2 WHERE id = $1", [id, toTs(now)]);
}

export async function listLinks(q: Queryable, userId: string): Promise<ConnectorLink[]> {
  const rows = await q.query<{ id: string; device_name: string; created_at: string; last_delivery_at: string | null }>("SELECT id, device_name, created_at, last_delivery_at FROM connector_links WHERE user_id = $1 ORDER BY created_at", [userId]);
  return rows.map((r) => ({ id: r.id, deviceName: r.device_name, createdAt: new Date(r.created_at).getTime(), lastDeliveryAt: r.last_delivery_at ? new Date(r.last_delivery_at).getTime() : null }));
}

export async function deleteLink(q: Queryable, id: string, userId?: string): Promise<boolean> {
  const rows = userId
    ? await q.query("DELETE FROM connector_links WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])
    : await q.query("DELETE FROM connector_links WHERE id = $1 RETURNING id", [id]);
  return rows.length > 0;
}

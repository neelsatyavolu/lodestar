import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Queryable, Row } from "./client";

// Sharing a trip with people by email. The owner invites an address as an
// editor or a viewer; the invite email's link carries a one-time token, and
// whoever opens it signed in joins the trip. Access is then by account, so
// changing an email or leaving never depends on addresses matching.

export type Role = "owner" | "editor" | "viewer";
export type Member = { id: string; email: string; canEdit: boolean; joined: boolean; name: string | null };

/** How long an invite link works. */
export const INVITE_TTL_MS = 14 * 86_400_000;
export const MAX_MEMBERS = 20;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number(new Date(String(v))));

const toMember = (r: Row): Member => ({ id: String(r.id), email: String(r.email), canEdit: Boolean(r.can_edit), joined: r.user_id !== null && r.user_id !== undefined, name: null });

/** True when `ownerId` owns the trip. */
async function owns(q: Queryable, ownerId: string, journeyId: string): Promise<boolean> {
  return (await q.query("SELECT 1 FROM journeys WHERE id = $1 AND user_id = $2", [journeyId, ownerId])).length > 0;
}

/** Invites `email` to the owner's trip, or re-invites them with a fresh link. Null when it isn't their trip or it's full. */
export async function inviteMember(q: Queryable, ownerId: string, journeyId: string, email: string, canEdit: boolean, now: number): Promise<{ member: Member; token: string } | null> {
  if (!(await owns(q, ownerId, journeyId))) return null;
  const address = email.trim().toLowerCase();
  const [count] = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM journey_members WHERE journey_id = $1", [journeyId]);
  const existing = await q.query("SELECT id FROM journey_members WHERE journey_id = $1 AND email = $2", [journeyId, address]);
  if (!existing.length && (count?.n ?? 0) >= MAX_MEMBERS) return null;
  const token = randomBytes(32).toString("base64url");
  const [row] = await q.query(
    `INSERT INTO journey_members (id, journey_id, email, can_edit, token_hash, invited_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
     ON CONFLICT (journey_id, email) DO UPDATE SET can_edit = EXCLUDED.can_edit, token_hash = EXCLUDED.token_hash, invited_at = EXCLUDED.invited_at
     RETURNING *`,
    [randomUUID(), journeyId, address, canEdit, hash(token), now],
  );
  return { member: toMember(row), token };
}

/** Everyone the owner shared the trip with, with the names they go by. */
export async function listMembers(q: Queryable, ownerId: string, journeyId: string): Promise<Member[] | null> {
  if (!(await owns(q, ownerId, journeyId))) return null;
  const rows = await q.query(
    `SELECT m.*, p.data->>'displayName' AS display_name FROM journey_members m
     LEFT JOIN preferences p ON p.user_id = m.user_id
     WHERE m.journey_id = $1 ORDER BY m.invited_at`,
    [journeyId],
  );
  return rows.map((r) => ({ ...toMember(r), name: (r.display_name as string | null) || null }));
}

export async function setMemberEdit(q: Queryable, ownerId: string, journeyId: string, memberId: string, canEdit: boolean): Promise<boolean> {
  if (!(await owns(q, ownerId, journeyId))) return false;
  return (await q.query("UPDATE journey_members SET can_edit = $3 WHERE id = $1 AND journey_id = $2 RETURNING id", [memberId, journeyId, canEdit])).length > 0;
}

/** The owner removes someone, or a member leaves (pass their own user id as `memberUserId`). */
export async function removeMember(q: Queryable, actorId: string, journeyId: string, memberId: string): Promise<boolean> {
  const rows = await q.query(
    `DELETE FROM journey_members m USING journeys j
     WHERE m.id = $1 AND m.journey_id = $2 AND j.id = m.journey_id AND (j.user_id = $3 OR m.user_id = $3)
     RETURNING m.id`,
    [memberId, journeyId, actorId],
  );
  return rows.length > 0;
}

/** A member leaves a trip shared with them. */
export async function leaveTrip(q: Queryable, userId: string, journeyId: string): Promise<boolean> {
  return (await q.query("DELETE FROM journey_members WHERE journey_id = $1 AND user_id = $2 RETURNING id", [journeyId, userId])).length > 0;
}

/** Joins the trip the invite is for. Works once; the trip's owner can't join their own trip. */
export async function acceptInvite(q: Queryable, userId: string, token: string, now: number): Promise<{ journeyId: string } | null> {
  const [row] = await q.query(
    `SELECT m.id, m.journey_id, m.invited_at, j.user_id AS owner_id FROM journey_members m JOIN journeys j ON j.id = m.journey_id WHERE m.token_hash = $1`,
    [hash(token)],
  );
  if (!row || now - ms(row.invited_at) > INVITE_TTL_MS) return null;
  const journeyId = String(row.journey_id);
  if (String(row.owner_id) === userId) return { journeyId };
  // Already in through another invite for this trip: keep that one, drop this.
  const [already] = await q.query("SELECT id FROM journey_members WHERE journey_id = $1 AND user_id = $2", [journeyId, userId]);
  if (already) {
    await q.query("DELETE FROM journey_members WHERE id = $1 AND id <> $2", [row.id, already.id]);
    return { journeyId };
  }
  await q.query("UPDATE journey_members SET user_id = $2, token_hash = NULL, joined_at = to_timestamp($3 / 1000.0) WHERE id = $1", [row.id, userId, now]);
  return { journeyId };
}

/** What `userId` may do with a trip, and whose rows it lives in; null when they have no access. */
export async function accessFor(q: Queryable, userId: string, journeyId: string): Promise<{ ownerId: string; role: Role } | null> {
  const [row] = await q.query(
    `SELECT j.user_id AS owner_id, m.can_edit FROM journeys j
     LEFT JOIN journey_members m ON m.journey_id = j.id AND m.user_id = $2
     WHERE j.id = $1`,
    [journeyId, userId],
  );
  if (!row) return null;
  const ownerId = String(row.owner_id);
  if (ownerId === userId) return { ownerId, role: "owner" };
  if (row.can_edit === null || row.can_edit === undefined) return null;
  return { ownerId, role: row.can_edit ? "editor" : "viewer" };
}

/** The trips shared with `userId`: which, as what, and the owner's name. */
export async function sharedWith(q: Queryable, userId: string): Promise<{ journeyId: string; ownerId: string; role: "editor" | "viewer"; owner: string }[]> {
  const rows = await q.query(
    `SELECT m.journey_id, j.user_id AS owner_id, m.can_edit, u.email, p.data->>'displayName' AS display_name
     FROM journey_members m JOIN journeys j ON j.id = m.journey_id JOIN users u ON u.id = j.user_id
     LEFT JOIN preferences p ON p.user_id = j.user_id
     WHERE m.user_id = $1`,
    [userId],
  );
  return rows.map((r) => ({
    journeyId: String(r.journey_id),
    ownerId: String(r.owner_id),
    role: r.can_edit ? "editor" : "viewer",
    owner: (r.display_name as string | null) || String(r.email).split("@")[0],
  }));
}

const CHILD_TABLES = { item: "journey_items", task: "journey_tasks", note: "journey_notes", cost: "journey_costs" } as const;
export type Child = keyof typeof CHILD_TABLES;

/** The trip and owner a checklist entry, note, cost or item belongs to. */
export async function childOf(q: Queryable, kind: Child, id: string): Promise<{ journeyId: string | null; ownerId: string } | null> {
  const [row] = await q.query(`SELECT journey_id, user_id FROM ${CHILD_TABLES[kind]} WHERE id = $1`, [id]);
  return row ? { journeyId: (row.journey_id as string | null) ?? null, ownerId: String(row.user_id) } : null;
}

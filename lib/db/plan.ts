import type { Cost, CostCategory, Note, Source, Task } from "../journeys/types";
import type { Queryable, Row } from "./client";
import { toTs } from "./time";

// A trip's checklist, notes and budget lines. Every query is scoped by user_id,
// and anything added must land in a trip of the same account.

export const MAX_PER_TRIP = 300;

const isoDate = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

const toTask = (r: Row): Task => ({
  id: r.id as string,
  journeyId: r.journey_id as string,
  title: r.title as string,
  done: Boolean(r.done),
  due: isoDate(r.due),
  section: r.section as string,
  position: Number(r.position),
  source: r.source as Source,
});

const toNote = (r: Row): Note => ({ id: r.id as string, journeyId: r.journey_id as string, title: r.title as string, body: r.body as string, position: Number(r.position), source: r.source as Source });

const toCost = (r: Row): Cost => ({
  id: r.id as string,
  journeyId: r.journey_id as string,
  label: r.label as string,
  amount: Number(r.amount),
  currency: r.currency as string,
  category: r.category as CostCategory,
  paid: Boolean(r.paid),
  source: r.source as Source,
});

/** Only inserts when the trip belongs to the account, so ids from another account do nothing. */
const OWNED = "EXISTS (SELECT 1 FROM journeys WHERE id = $3 AND user_id = $2)";

async function count(q: Queryable, table: string, userId: string, journeyId: string): Promise<number> {
  const [row] = await q.query<{ n: string | number }>(`SELECT count(*) AS n FROM ${table} WHERE user_id = $1 AND journey_id = $2`, [userId, journeyId]);
  return Number(row?.n ?? 0);
}

async function nextPosition(q: Queryable, table: string, userId: string, journeyId: string): Promise<number> {
  const [row] = await q.query<{ p: string | number | null }>(`SELECT max(position) AS p FROM ${table} WHERE user_id = $1 AND journey_id = $2`, [userId, journeyId]);
  return row?.p === null || row?.p === undefined ? 0 : Number(row.p) + 1;
}

// ---------- Tasks ----------

export async function listTasks(q: Queryable, userId: string, journeyId: string): Promise<Task[]> {
  return (await q.query("SELECT * FROM journey_tasks WHERE user_id = $1 AND journey_id = $2 ORDER BY position, created_at", [userId, journeyId])).map(toTask);
}

export const countTasks = (q: Queryable, userId: string, journeyId: string) => count(q, "journey_tasks", userId, journeyId);

export type NewTask = { id: string; title: string; due: string | null; section: string; source: Source };

/** Adds tasks in order after the existing ones. Returns the stored tasks, or null when the trip isn't the account's. */
export async function addTasks(q: Queryable, userId: string, journeyId: string, tasks: NewTask[], now: number): Promise<Task[] | null> {
  let position = await nextPosition(q, "journey_tasks", userId, journeyId);
  const out: Task[] = [];
  for (const t of tasks) {
    const [row] = await q.query(
      `INSERT INTO journey_tasks (id, user_id, journey_id, title, done, due, section, position, source, created_at)
       SELECT $1, $2, $3, $4, false, $5, $6, $7, $8, $9 WHERE ${OWNED} RETURNING *`,
      [t.id, userId, journeyId, t.title, t.due, t.section, position++, t.source, toTs(now)],
    );
    if (!row) return null;
    out.push(toTask(row));
  }
  return out;
}

export type TaskPatch = Partial<{ title: string; done: boolean; due: string | null; section: string }>;

export async function updateTask(q: Queryable, userId: string, id: string, patch: TaskPatch): Promise<Task | null> {
  const keys = (["title", "done", "due", "section"] as const).filter((k) => patch[k] !== undefined);
  if (!keys.length) {
    const [row] = await q.query("SELECT * FROM journey_tasks WHERE id = $1 AND user_id = $2", [id, userId]);
    return row ? toTask(row) : null;
  }
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const [row] = await q.query(`UPDATE journey_tasks SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId, ...keys.map((k) => patch[k])]);
  return row ? toTask(row) : null;
}

export async function deleteTask(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query("DELETE FROM journey_tasks WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
}

// ---------- Notes ----------

export async function listNotes(q: Queryable, userId: string, journeyId: string): Promise<Note[]> {
  return (await q.query("SELECT * FROM journey_notes WHERE user_id = $1 AND journey_id = $2 ORDER BY position, created_at", [userId, journeyId])).map(toNote);
}

export const countNotes = (q: Queryable, userId: string, journeyId: string) => count(q, "journey_notes", userId, journeyId);

/**
 * Writes a note. A note with the same title (any case) in the trip is replaced,
 * so "Dietary needs" written twice stays one note. Null when the trip isn't the account's.
 */
export async function putNote(q: Queryable, userId: string, journeyId: string, n: { id: string; title: string; body: string; source: Source }, now: number): Promise<Note | null> {
  const [same] = await q.query("SELECT id FROM journey_notes WHERE user_id = $1 AND journey_id = $2 AND lower(title) = lower($3)", [userId, journeyId, n.title]);
  if (same) {
    const [row] = await q.query("UPDATE journey_notes SET title = $3, body = $4, source = $5 WHERE id = $1 AND user_id = $2 RETURNING *", [same.id, userId, n.title, n.body, n.source]);
    return toNote(row);
  }
  const position = await nextPosition(q, "journey_notes", userId, journeyId);
  const [row] = await q.query(
    `INSERT INTO journey_notes (id, user_id, journey_id, title, body, position, source, created_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8 WHERE ${OWNED} RETURNING *`,
    [n.id, userId, journeyId, n.title, n.body, position, n.source, toTs(now)],
  );
  return row ? toNote(row) : null;
}

export async function updateNote(q: Queryable, userId: string, id: string, patch: Partial<{ title: string; body: string }>): Promise<Note | null> {
  const keys = (["title", "body"] as const).filter((k) => patch[k] !== undefined);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const [row] = await q.query(`UPDATE journey_notes SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId, ...keys.map((k) => patch[k])]);
  return row ? toNote(row) : null;
}

export async function deleteNote(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query("DELETE FROM journey_notes WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
}

// ---------- Costs ----------

export async function listCosts(q: Queryable, userId: string, journeyId: string): Promise<Cost[]> {
  return (await q.query("SELECT * FROM journey_costs WHERE user_id = $1 AND journey_id = $2 ORDER BY created_at", [userId, journeyId])).map(toCost);
}

export const countCosts = (q: Queryable, userId: string, journeyId: string) => count(q, "journey_costs", userId, journeyId);

export type NewCost = { id: string; label: string; amount: number; currency: string; category: CostCategory; paid: boolean; source: Source };

export async function addCost(q: Queryable, userId: string, journeyId: string, c: NewCost, now: number): Promise<Cost | null> {
  const [row] = await q.query(
    `INSERT INTO journey_costs (id, user_id, journey_id, label, amount, currency, category, paid, source, created_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10 WHERE ${OWNED} RETURNING *`,
    [c.id, userId, journeyId, c.label, c.amount, c.currency, c.category, c.paid, c.source, toTs(now)],
  );
  return row ? toCost(row) : null;
}

export type CostPatch = Partial<{ label: string; amount: number; currency: string; category: CostCategory; paid: boolean }>;

export async function updateCost(q: Queryable, userId: string, id: string, patch: CostPatch): Promise<Cost | null> {
  const keys = (["label", "amount", "currency", "category", "paid"] as const).filter((k) => patch[k] !== undefined);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const [row] = await q.query(`UPDATE journey_costs SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId, ...keys.map((k) => patch[k])]);
  return row ? toCost(row) : null;
}

export async function deleteCost(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query("DELETE FROM journey_costs WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
}

/** Clears the AI's earlier estimates before a fresh set replaces them; lines the traveller or an agent added stay. */
export async function deleteAiCosts(q: Queryable, userId: string, journeyId: string): Promise<void> {
  await q.query("DELETE FROM journey_costs WHERE user_id = $1 AND journey_id = $2 AND source = 'ai' AND NOT paid", [userId, journeyId]);
}

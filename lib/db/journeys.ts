import type { Details, DraftItem, Item, Journey, JourneyWithItems, Kind, Source, Status } from "../journeys/types";
import type { Queryable, Row } from "./client";
import { toTs } from "./time";

// Trips in the organizer ("journeys") and their items. Every query is scoped
// by user_id so one account can never read or change another's.

export const MAX_JOURNEYS = 500;
export const MAX_ITEMS = 5000;

const isoDate = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const ms = (v: unknown): number => new Date(v as string).getTime();

const toJourney = (r: Row): Journey => ({
  id: r.id as string,
  title: r.title as string,
  destination: (r.destination as string | null) ?? null,
  startDate: isoDate(r.start_date),
  endDate: isoDate(r.end_date),
  source: r.source as Source,
  createdAt: ms(r.created_at),
});

const toItem = (r: Row): Item => ({
  id: r.id as string,
  journeyId: (r.journey_id as string | null) ?? null,
  kind: r.kind as Kind,
  status: r.status as Status,
  title: r.title as string,
  startDate: isoDate(r.start_date)!,
  startTime: (r.start_time as string | null) ?? null,
  endDate: isoDate(r.end_date),
  endTime: (r.end_time as string | null) ?? null,
  place: (r.place as string | null) ?? null,
  confirmation: (r.confirmation as string | null) ?? null,
  details: (r.details as Details) ?? {},
  source: r.source as Source,
  dedupeKey: (r.dedupe_key as string | null) ?? null,
  updatedAt: ms(r.updated_at),
});

const ITEM_ORDER = "ORDER BY start_date, start_time NULLS FIRST, created_at";

/** Every trip with its items, plus items not yet filed in a trip. */
export async function listJourneys(q: Queryable, userId: string): Promise<{ journeys: JourneyWithItems[]; unfiled: Item[] }> {
  const journeys = (await q.query(`SELECT * FROM journeys WHERE user_id = $1 ORDER BY start_date NULLS LAST, created_at`, [userId])).map(toJourney);
  const items = (await q.query(`SELECT * FROM journey_items WHERE user_id = $1 ${ITEM_ORDER} LIMIT ${MAX_ITEMS}`, [userId])).map(toItem);
  const byJourney = new Map<string, Item[]>();
  for (const it of items) if (it.journeyId) byJourney.set(it.journeyId, [...(byJourney.get(it.journeyId) ?? []), it]);
  return { journeys: journeys.map((j) => ({ ...j, items: byJourney.get(j.id) ?? [] })), unfiled: items.filter((i) => !i.journeyId) };
}

/** Trips without their items, for deciding where new items go. */
export async function journeyHeads(q: Queryable, userId: string): Promise<Journey[]> {
  return (await q.query("SELECT * FROM journeys WHERE user_id = $1", [userId])).map(toJourney);
}

export async function getJourney(q: Queryable, userId: string, id: string): Promise<JourneyWithItems | null> {
  const [row] = await q.query("SELECT * FROM journeys WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!row) return null;
  const items = (await q.query(`SELECT * FROM journey_items WHERE journey_id = $1 AND user_id = $2 ${ITEM_ORDER}`, [id, userId])).map(toItem);
  return { ...toJourney(row), items };
}

export async function countJourneys(q: Queryable, userId: string): Promise<number> {
  const [row] = await q.query<{ n: string | number }>("SELECT count(*) AS n FROM journeys WHERE user_id = $1", [userId]);
  return Number(row?.n ?? 0);
}

export async function countItems(q: Queryable, userId: string): Promise<number> {
  const [row] = await q.query<{ n: string | number }>("SELECT count(*) AS n FROM journey_items WHERE user_id = $1", [userId]);
  return Number(row?.n ?? 0);
}

export type NewJourney = { id: string; title: string; destination: string | null; startDate: string | null; endDate: string | null; source: Source; externalKey?: string | null; now: number };

/** Creates a trip, or with an external key already imported, updates that one. Returns the trip's id. */
export async function upsertJourney(q: Queryable, userId: string, j: NewJourney): Promise<string> {
  const [row] = await q.query<{ id: string }>(
    `INSERT INTO journeys (id, user_id, title, destination, start_date, end_date, source, external_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (user_id, external_key) WHERE external_key IS NOT NULL
     DO UPDATE SET title = EXCLUDED.title, destination = EXCLUDED.destination, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [j.id, userId, j.title, j.destination, j.startDate, j.endDate, j.source, j.externalKey ?? null, toTs(j.now)],
  );
  return row.id;
}

export type JourneyPatch = Partial<Pick<Journey, "title" | "destination" | "startDate" | "endDate">>;

export async function updateJourney(q: Queryable, userId: string, id: string, patch: JourneyPatch, now: number): Promise<boolean> {
  const cols: Record<keyof JourneyPatch, string> = { title: "title", destination: "destination", startDate: "start_date", endDate: "end_date" };
  const keys = (Object.keys(patch) as (keyof JourneyPatch)[]).filter((k) => patch[k] !== undefined);
  const sets = keys.map((k, i) => `${cols[k]} = $${i + 3}`);
  const rows = await q.query(`UPDATE journeys SET ${[...sets, `updated_at = $${keys.length + 3}`].join(", ")} WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId, ...keys.map((k) => patch[k]), toTs(now)]);
  return rows.length > 0;
}

/** Stretches a trip's dates to cover a span; dates the traveller set stay unless the span is outside them. */
export async function widenJourney(q: Queryable, userId: string, id: string, start: string, end: string): Promise<void> {
  await q.query(
    `UPDATE journeys SET start_date = LEAST(COALESCE(start_date, $3::date), $3::date), end_date = GREATEST(COALESCE(end_date, $4::date), $4::date) WHERE id = $1 AND user_id = $2`,
    [id, userId, start, end],
  );
}

export async function deleteJourney(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query("DELETE FROM journeys WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
}

/** Trips that already hold any of these bookings, keyed by dedupe key. */
export async function journeysForKeys(q: Queryable, userId: string, keys: string[]): Promise<Map<string, string | null>> {
  if (!keys.length) return new Map();
  const rows = await q.query<{ dedupe_key: string; journey_id: string | null }>("SELECT dedupe_key, journey_id FROM journey_items WHERE user_id = $1 AND dedupe_key = ANY($2::text[])", [userId, keys]);
  return new Map(rows.map((r) => [r.dedupe_key, r.journey_id]));
}

export type NewItem = { id: string; journeyId: string | null; source: Source; dedupeKey: string | null; item: DraftItem; now: number };

/**
 * Inserts an item. When the same booking arrives again (same dedupe key) its
 * times, place, details and status update, while the trip it's filed in and
 * a title the traveller edited are kept. Returns the stored item's id.
 */
export async function upsertItem(q: Queryable, userId: string, n: NewItem): Promise<string> {
  const i = n.item;
  const [row] = await q.query<{ id: string }>(
    `INSERT INTO journey_items (id, user_id, journey_id, kind, status, title, start_date, start_time, end_date, end_time, place, confirmation, dedupe_key, details, source, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $16)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET
       journey_id = COALESCE(journey_items.journey_id, EXCLUDED.journey_id),
       status = EXCLUDED.status,
       start_date = EXCLUDED.start_date, start_time = COALESCE(EXCLUDED.start_time, journey_items.start_time),
       end_date = COALESCE(EXCLUDED.end_date, journey_items.end_date), end_time = COALESCE(EXCLUDED.end_time, journey_items.end_time),
       place = COALESCE(EXCLUDED.place, journey_items.place), confirmation = COALESCE(EXCLUDED.confirmation, journey_items.confirmation),
       details = journey_items.details || EXCLUDED.details,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [n.id, userId, n.journeyId, i.kind, i.status, i.title, i.startDate, i.startTime, i.endDate, i.endTime, i.place, i.confirmation, n.dedupeKey, JSON.stringify(i.details), n.source, toTs(n.now)],
  );
  return row.id;
}

export type ItemPatch = Partial<Pick<Item, "status" | "journeyId" | "title" | "startDate" | "startTime" | "endDate" | "endTime" | "place" | "confirmation">> & { note?: string | null };

export async function updateItem(q: Queryable, userId: string, id: string, patch: ItemPatch, now: number): Promise<Item | null> {
  const cols: Record<Exclude<keyof ItemPatch, "note">, string> = {
    status: "status", journeyId: "journey_id", title: "title", startDate: "start_date", startTime: "start_time", endDate: "end_date", endTime: "end_time", place: "place", confirmation: "confirmation",
  };
  const keys = (Object.keys(cols) as (keyof typeof cols)[]).filter((k) => patch[k] !== undefined);
  const params: unknown[] = [id, userId, ...keys.map((k) => patch[k])];
  const sets = keys.map((k, i) => `${cols[k]} = $${i + 3}`);
  if (patch.note === null) sets.push(`details = details - 'note'`);
  else if (patch.note !== undefined) {
    params.push(patch.note);
    sets.push(`details = details || jsonb_build_object('note', $${params.length}::text)`);
  }
  params.push(toTs(now));
  sets.push(`updated_at = $${params.length}`);
  // A trip it moves into must be the same account's.
  const guard = patch.journeyId ? ` AND EXISTS (SELECT 1 FROM journeys WHERE id = $${keys.indexOf("journeyId") + 3} AND user_id = $2)` : "";
  const [row] = await q.query(`UPDATE journey_items SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2${guard} RETURNING *`, params);
  return row ? toItem(row) : null;
}

export async function deleteItem(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query("DELETE FROM journey_items WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
}

/** Clears a trip's earlier suggestions of one kind before a fresh set replaces them. */
export async function deleteSuggestions(q: Queryable, userId: string, journeyId: string, kind: Kind): Promise<void> {
  await q.query("DELETE FROM journey_items WHERE user_id = $1 AND journey_id = $2 AND kind = $3 AND status = 'suggested'", [userId, journeyId, kind]);
}

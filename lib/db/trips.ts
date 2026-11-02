import type { AlertState } from "../trips/alerts";
import type { Booking } from "../trips/booked";
import type { Snapshot, UpdateAlerts } from "../trips/input";
import type { SearchQuery } from "../types";
import type { Queryable, Row } from "./client";
import { toTs } from "./time";

/** A saved trip as listed in Trips (the shortlist snapshot is fetched separately). */
export type TripSummary = {
  id: string;
  title: string;
  prompt: string;
  savedPrice: number;
  lastPrice: number | null;
  checkedAt: number | null;
  alertDrop: boolean;
  targetPrice: number | null;
  targetHit: boolean;
  remindOn: string | null;
  reminded: boolean;
  firstDepart: string;
  createdAt: number;
  /** Set once booked: alerts then watch this fare against what was paid. */
  booking: Booking | null;
};

export type NewTrip = { id: string; title: string; prompt: string; queries: SearchQuery[]; snapshot: Snapshot; firstDepart: string; price: number; createdAt: number };

/** A trip the daily check should look at, with where to send its email. */
export type DueTrip = AlertState & { id: string; title: string; email: string; queries: SearchQuery[]; booking: Booking | null };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
// pg returns dates as Date objects; PGlite as Date too. Keep them as YYYY-MM-DD.
const isoDate = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

const toSummary = (r: Row): TripSummary => ({
  id: r.id as string,
  title: r.title as string,
  prompt: r.prompt as string,
  savedPrice: Number(r.saved_price),
  lastPrice: num(r.last_price),
  checkedAt: r.checked_at ? new Date(r.checked_at as string).getTime() : null,
  alertDrop: Boolean(r.alert_drop),
  targetPrice: num(r.target_price),
  targetHit: Boolean(r.target_hit),
  remindOn: isoDate(r.remind_on),
  reminded: Boolean(r.reminded),
  firstDepart: isoDate(r.first_depart)!,
  createdAt: new Date(r.created_at as string).getTime(),
  booking: (r.booking as Booking | null) ?? null,
});

const SUMMARY_COLUMNS = "id, title, prompt, saved_price, last_price, checked_at, alert_drop, target_price, target_hit, remind_on, reminded, first_depart, created_at, booking";

export async function insertTrip(q: Queryable, userId: string, t: NewTrip): Promise<void> {
  await q.query(
    `INSERT INTO saved_trips (id, user_id, title, prompt, queries, snapshot, first_depart, saved_price, alert_price, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $8, $9)`,
    [t.id, userId, t.title, t.prompt, JSON.stringify(t.queries), JSON.stringify(t.snapshot), t.firstDepart, t.price, toTs(t.createdAt)],
  );
}

export async function countTrips(q: Queryable, userId: string): Promise<number> {
  const [row] = await q.query<{ n: string | number }>("SELECT count(*) AS n FROM saved_trips WHERE user_id = $1", [userId]);
  return Number(row?.n ?? 0);
}

export async function listTrips(q: Queryable, userId: string): Promise<TripSummary[]> {
  const rows = await q.query(`SELECT ${SUMMARY_COLUMNS} FROM saved_trips WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return rows.map(toSummary);
}

export async function getTripSnapshot(q: Queryable, userId: string, id: string): Promise<Snapshot | null> {
  const [row] = await q.query<{ snapshot: Snapshot }>("SELECT snapshot FROM saved_trips WHERE id = $1 AND user_id = $2", [id, userId]);
  return row?.snapshot ?? null;
}

/** Changes the trip's alerts. A new target starts unfired; a new reminder date starts unsent. Null when it isn't theirs. */
export async function updateTripAlerts(q: Queryable, userId: string, id: string, change: UpdateAlerts): Promise<TripSummary | null> {
  const sets: string[] = [];
  const params: unknown[] = [id, userId];
  const set = (sql: string, value: unknown) => {
    params.push(value);
    sets.push(sql.replace("?", `$${params.length}`));
  };
  if (change.alertDrop !== undefined) set("alert_drop = ?", change.alertDrop);
  if (change.targetPrice !== undefined) {
    set("target_price = ?", change.targetPrice);
    sets.push("target_hit = false");
  }
  if (change.remindOn !== undefined) {
    set("remind_on = ?", change.remindOn);
    sets.push("reminded = false");
  }
  const [row] = await q.query(`UPDATE saved_trips SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING ${SUMMARY_COLUMNS}`, params);
  return row ? toSummary(row) : null;
}

/**
 * Marks the trip booked. Drops are then measured from what was paid, alerts run
 * until the booked flight leaves, and the shortlist's target and reminder are
 * cleared since they no longer apply.
 * Null when the trip isn't theirs or the itinerary isn't one of its options.
 */
export async function setBooking(q: Queryable, userId: string, id: string, b: Booking): Promise<TripSummary | null> {
  const [row] = await q.query(
    `UPDATE saved_trips t
     SET booking = $3::jsonb, first_depart = o.depart, alert_price = $4, alert_drop = true, target_price = NULL, target_hit = false, remind_on = NULL, reminded = false, last_price = NULL, checked_at = NULL
     FROM (
       SELECT s.id, COALESCE(left(e.value->'itinerary'->'slices'->0->'legs'->0->>'depart', 10)::date, s.first_depart) AS depart
       FROM saved_trips s, jsonb_each(s.snapshot->'options') e
       WHERE s.id = $1 AND e.value->'itinerary'->>'tfs' = $5
       LIMIT 1
     ) o
     WHERE t.id = o.id AND t.user_id = $2
     RETURNING ${SUMMARY_COLUMNS.split(", ").map((c) => `t.${c}`).join(", ")}`,
    [id, userId, JSON.stringify(b), b.paid, b.tfs],
  );
  return row ? toSummary(row) : null;
}

/** Undoes setBooking: alerts go back to watching the shortlist from its saved fare, until its first search date. */
export async function clearBooking(q: Queryable, userId: string, id: string): Promise<TripSummary | null> {
  const [row] = await q.query(
    `UPDATE saved_trips
     SET booking = NULL, alert_price = saved_price, last_price = NULL, checked_at = NULL,
         first_depart = (SELECT min((s->>'depart')::date) FROM jsonb_array_elements(queries) s)
     WHERE id = $1 AND user_id = $2 RETURNING ${SUMMARY_COLUMNS}`,
    [id, userId],
  );
  return row ? toSummary(row) : null;
}

export async function deleteTrip(q: Queryable, userId: string, id: string): Promise<boolean> {
  const rows = await q.query("DELETE FROM saved_trips WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
  return rows.length === 1;
}

/**
 * Trips with an alert still to fire that haven't departed, least recently checked first.
 * Mirrors isDue() in SQL so the daily check only loads what it will search.
 */
export async function dueTrips(q: Queryable, today: string, limit: number): Promise<DueTrip[]> {
  const rows = await q.query(
    `SELECT t.id, t.title, t.queries, t.alert_price, t.alert_drop, t.target_price, t.target_hit, t.remind_on, t.reminded, t.first_depart, t.booking, u.email
     FROM saved_trips t JOIN users u ON u.id = t.user_id
     WHERE t.first_depart > $1
       AND (t.alert_drop OR (t.target_price IS NOT NULL AND NOT t.target_hit) OR (t.remind_on IS NOT NULL AND NOT t.reminded))
     ORDER BY t.checked_at ASC NULLS FIRST
     LIMIT $2`,
    [today, limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    email: r.email as string,
    queries: r.queries as SearchQuery[],
    alertPrice: Number(r.alert_price),
    alertDrop: Boolean(r.alert_drop),
    targetPrice: num(r.target_price),
    targetHit: Boolean(r.target_hit),
    remindOn: isoDate(r.remind_on),
    reminded: Boolean(r.reminded),
    firstDepart: isoDate(r.first_depart)!,
    booking: (r.booking as Booking | null) ?? null,
  }));
}

/**
 * Saves a check's result, unless the trip was booked or unbooked while it ran:
 * that reset the alert state, and this result was measured against the old one.
 */
export async function recordCheck(q: Queryable, id: string, booking: Booking | null, check: { lastPrice: number | null; checkedAt: number; alertPrice: number; targetHit: boolean; reminded: boolean }): Promise<void> {
  await q.query(
    `UPDATE saved_trips SET last_price = COALESCE($2, last_price), checked_at = $3, alert_price = $4, target_hit = $5, reminded = $6
     WHERE id = $1 AND booking IS NOT DISTINCT FROM $7::jsonb`,
    [id, check.lastPrice, toTs(check.checkedAt), check.alertPrice, check.targetHit, check.reminded, booking ? JSON.stringify(booking) : null],
  );
}

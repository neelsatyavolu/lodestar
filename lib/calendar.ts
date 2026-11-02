// Date helpers for the calendar picker. Dates are ISO "YYYY-MM-DD" strings in
// the traveller's local calendar; all math runs at UTC noon so DST never
// shifts a day.

export type Iso = string;

const at = (iso: Iso) => new Date(`${iso}T12:00:00Z`);
const iso = (d: Date): Iso => d.toISOString().slice(0, 10);

export function addDaysIso(day: Iso, n: number): Iso {
  const d = at(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** First day of the month containing `day`, moved by `n` months. */
export function addMonths(day: Iso, n: number): Iso {
  const d = at(day);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12)));
}

export function monthStart(day: Iso): Iso {
  return addMonths(day, 0);
}

export function nightsBetween(a: Iso, b: Iso): number {
  return Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000);
}

/**
 * The weeks of a month as rows of seven cells, Sunday first. Cells outside the
 * month are null so the grid keeps its shape.
 */
export function monthGrid(month: Iso): (Iso | null)[][] {
  const first = at(monthStart(month));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (Iso | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => addDaysIso(iso(first), i))];
  while (cells.length % 7) cells.push(null);
  const weeks: (Iso | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export const monthLabel = (month: Iso) => MONTH.format(at(month));
export const longLabel = (day: Iso) => LONG.format(at(day));
export const shortLabel = (day: Iso) => SHORT.format(at(day));
export const dayOfMonth = (day: Iso) => Number(day.slice(8, 10));

export type Phase = "depart" | "return";
export type Range = { depart: Iso; return: Iso | null };

/**
 * What a click on `day` does. One-way: it is the departure. Round trip: while
 * picking the departure it sets it (keeping a later return); while picking the
 * return a later-or-same day becomes the return, an earlier one restarts the
 * range from that day.
 */
export function pick(range: Range, day: Iso, phase: Phase, roundTrip: boolean): { range: Range; phase: Phase; done: boolean } {
  if (!roundTrip) return { range: { depart: day, return: range.return }, phase: "depart", done: true };
  if (phase === "depart") {
    const keepReturn = range.return && range.return >= day ? range.return : null;
    return { range: { depart: day, return: keepReturn }, phase: "return", done: false };
  }
  if (day < range.depart) return { range: { depart: day, return: null }, phase: "return", done: false };
  return { range: { depart: range.depart, return: day }, phase: "depart", done: true };
}

/** Lowest price in a day → price map, ignoring days before `from`. */
export function cheapestDay(prices: Map<Iso, number>, from: Iso): Iso | null {
  let best: Iso | null = null;
  for (const [day, price] of prices) if (day >= from && (best === null || price < prices.get(best)!)) best = day;
  return best;
}

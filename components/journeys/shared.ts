import { api, ApiError } from "@/lib/client";
import { addDays, day } from "@/lib/format";
import type { MailSummary } from "@/lib/db/inbound";
import type { Item, JourneyWithItems, TripDetail, TripType } from "@/lib/journeys/types";

// Client-side helpers for the Trips organizer.

export type Overview = { journeys: PlanTrip[]; unfiled: Item[]; mail: MailSummary[] };

export const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export const today = () => new Date().toLocaleDateString("en-CA");

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** "Mar 1 – Mar 10, 2027", or "Dates not set". */
export function dateRange(start: string | null, end: string | null): string {
  if (!start) return "Dates not set";
  const short = (iso: string) => day(iso).replace(/^\w+, /, "");
  const year = (end ?? start).slice(0, 4);
  return !end || end === start ? `${short(start)}, ${year}` : `${short(start)} – ${short(end)}, ${year}`;
}

/** "In 12 days", "Tomorrow", "Day 3 of 8", "Ended". */
export function countdown(j: Pick<JourneyWithItems, "startDate" | "endDate">, now = today()): string | null {
  if (!j.startDate) return null;
  const end = j.endDate ?? j.startDate;
  if (now < j.startDate) {
    const n = daysBetween(now, j.startDate);
    return n === 1 ? "Tomorrow" : `In ${n} days`;
  }
  if (now <= end) return `Day ${daysBetween(j.startDate, now) + 1} of ${daysBetween(j.startDate, end) + 1}`;
  return null;
}

export const isPast = (j: Pick<JourneyWithItems, "startDate" | "endDate">, now = today()) => Boolean(j.startDate && (j.endDate ?? j.startDate) < now);

const KIND_WORD: Record<string, [string, string]> = { flight: ["flight", "flights"], stay: ["stay", "stays"], dining: ["reservation", "reservations"], activity: ["plan", "plans"], transport: ["transfer", "transfers"] };

/** "2 flights · 1 stay · 3 reservations" from booked and planned items. */
export function tally(items: Item[]): string {
  const counts = new Map<string, number>();
  for (const i of items) if (i.status !== "suggested" && i.status !== "cancelled" && KIND_WORD[i.kind]) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${KIND_WORD[k][n === 1 ? 0 : 1]}`).join(" · ") || "Nothing booked yet";
}

/** Every day the trip covers plus any day an item falls on, in order. */
export function daysOf(j: JourneyWithItems): string[] {
  const set = new Set<string>();
  if (j.startDate) for (let d = j.startDate; d <= (j.endDate ?? j.startDate) && set.size < 60; d = addDays(d, 1)) set.add(d);
  for (const i of j.items) set.add(i.startDate);
  return [...set].sort();
}

/** The stay you sleep at on a given night: checked in on or before it, checking out after it. */
export const stayOn = (items: Item[], date: string) =>
  items.find((i) => i.kind === "stay" && (i.status === "booked" || i.status === "planned") && i.startDate <= date && (i.endDate ?? i.startDate) > date) ?? null;

// ---------- Trip planner ----------

/** A trip as the list holds it: the full plan once the trip page has loaded it. */
export type PlanTrip = JourneyWithItems & Partial<Pick<TripDetail, "tasks" | "notes" | "costs">>;

export const fullTrip = (j: PlanTrip): TripDetail => ({ ...j, tasks: j.tasks ?? [], notes: j.notes ?? [], costs: j.costs ?? [] });

/** "Nov 21". */
export const shortDate = (iso: string) => day(iso).replace(/^\w+, /, "");

/** "$1,240" or "€30.50": whole amounts drop the cents. */
export function amount(n: number, currency = "USD"): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(whole ? 0 : 2)}`;
  }
}

export const TRIP_TYPE_LABEL: Record<TripType, string> = { city: "City break", beach: "Beach", road: "Road trip", family: "Family", adventure: "Adventure", ski: "Ski", business: "Work", other: "Something else" };

/** How urgent a book-by date is: past it, within a week, or later. */
export function deadline(bookBy: string | undefined, now = today()): { text: string; tone: "danger" | "warn" | null } | null {
  if (!bookBy) return null;
  const n = daysBetween(now, bookBy);
  if (n < 0) return { text: `Was due ${shortDate(bookBy)}`, tone: "danger" };
  if (n === 0) return { text: "Book today", tone: "danger" };
  return { text: `Book by ${shortDate(bookBy)}`, tone: n <= 7 ? "warn" : null };
}

export const travellers = (n: number | null) => (n ? `${n} ${n === 1 ? "traveller" : "travellers"}` : null);

export async function patchItem(id: string, body: Record<string, unknown>): Promise<Item> {
  const { item } = await api<{ item: Item }>(`/api/journeys/items/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  return item;
}

/** "19:05" → "7:05 PM". */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** "2:05 PM – 2:25 PM", "7:00 PM", or null without a time. An end the next day is marked +1; a later one names its day. */
export function timeRange(i: Pick<Item, "startTime" | "endTime" | "startDate" | "endDate" | "kind">): string | null {
  if (!i.startTime) return null;
  if (!i.endTime || i.kind === "stay") return time12(i.startTime);
  if (!i.endDate || i.endDate === i.startDate) return `${time12(i.startTime)} – ${time12(i.endTime)}`;
  if (i.endDate === addDays(i.startDate, 1)) return `${time12(i.startTime)} – ${time12(i.endTime)} +1`;
  const endDay = new Date(`${i.endDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${time12(i.startTime)} – ${endDay}, ${time12(i.endTime)}`;
}

/** "Saturday, November 21". */
export const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

import { ApiError } from "@/lib/client";
import { addDays, day } from "@/lib/format";
import type { MailSummary } from "@/lib/db/inbound";
import type { Item, JourneyWithItems } from "@/lib/journeys/types";

// Client-side helpers for the Trips organizer.

export type Overview = { journeys: JourneyWithItems[]; unfiled: Item[]; mail: MailSummary[] };

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

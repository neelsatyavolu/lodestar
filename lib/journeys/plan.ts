import { addDays } from "../format";
import type { CostCategory, Item, Kind, TripDetail, TripType } from "./types";

// What the trip page's tabs show, worked out from a trip's items, checklist and
// costs. Pure, so the page, the share view and agents all see the same thing.

const live = (i: Item) => i.status !== "cancelled" && i.status !== "suggested";
const when = (i: Item) => `${i.startDate} ${i.startTime ?? "99:99"}`;

/** Planned things that still need reserving, soonest deadline first. */
export function toBook(items: Item[]): Item[] {
  const due = (i: Item) => i.details.bookBy ?? i.startDate;
  return items.filter((i) => i.status === "planned" && i.details.reserve).sort((a, b) => due(a).localeCompare(due(b)) || when(a).localeCompare(when(b)));
}

const BOOKING_ORDER: Kind[] = ["flight", "stay", "transport", "activity", "dining"];

/** Booked (and cancelled) reservations by kind, flights first, each in date order. */
export function bookings(items: Item[]): { kind: Kind; items: Item[] }[] {
  return BOOKING_ORDER.map((kind) => ({
    kind,
    items: items.filter((i) => i.kind === kind && (i.status === "booked" || i.status === "cancelled")).sort((a, b) => when(a).localeCompare(when(b))),
  })).filter((g) => g.items.length > 0);
}

export const CATEGORY_OF: Record<Kind, CostCategory> = { flight: "flights", stay: "stays", transport: "transport", dining: "dining", activity: "activities", note: "other" };

export type BudgetLine = { category: CostCategory; paid: number; estimated: number };
export type Budget = { currency: string; lines: BudgetLine[]; paid: number; estimated: number; total: number; perPerson: number | null; otherCurrencies: string[] };

/**
 * Paid is what bookings cost and costs marked paid; estimated is what planned
 * things and unpaid costs are expected to. Sums one currency, the trip's most
 * common; entries in others are named, not converted.
 */
export function budget(trip: Pick<TripDetail, "items" | "costs" | "travelers">): Budget {
  type Entry = { category: CostCategory; amount: number; currency: string; paid: boolean };
  const entries: Entry[] = [];
  for (const i of trip.items) {
    if (!live(i)) continue;
    const currency = (i.details.currency ?? "USD").toUpperCase();
    if (i.status === "booked" && i.details.price !== undefined) entries.push({ category: CATEGORY_OF[i.kind], amount: i.details.price, currency, paid: true });
    else if (i.details.estimate !== undefined) entries.push({ category: CATEGORY_OF[i.kind], amount: i.details.estimate, currency, paid: false });
    else if (i.status === "planned" && i.details.price !== undefined) entries.push({ category: CATEGORY_OF[i.kind], amount: i.details.price, currency, paid: false });
  }
  for (const c of trip.costs) entries.push({ category: c.category, amount: c.amount, currency: c.currency.toUpperCase(), paid: c.paid });

  const tally = new Map<string, number>();
  for (const e of entries) tally.set(e.currency, (tally.get(e.currency) ?? 0) + 1);
  const currency = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const lines = new Map<CostCategory, BudgetLine>();
  for (const e of entries) {
    if (e.currency !== currency) continue;
    const line = lines.get(e.category) ?? { category: e.category, paid: 0, estimated: 0 };
    lines.set(e.category, e.paid ? { ...line, paid: line.paid + e.amount } : { ...line, estimated: line.estimated + e.amount });
  }
  const ordered = (["flights", "stays", "transport", "dining", "activities", "other"] as const).flatMap((c) => (lines.has(c) ? [lines.get(c)!] : []));
  const paid = ordered.reduce((s, l) => s + l.paid, 0);
  const estimated = ordered.reduce((s, l) => s + l.estimated, 0);
  const total = paid + estimated;
  return { currency, lines: ordered, paid, estimated, total, perPerson: trip.travelers && trip.travelers > 1 ? Math.round(total / trip.travelers) : null, otherCurrencies: [...tally.keys()].filter((c) => c !== currency) };
}

/** Each night of the trip and where it's spent: a run of nights at one stay, or a run with none. */
export type NightRun = { from: string; to: string; nights: number; stay: Item | null };

export function nights(trip: Pick<TripDetail, "startDate" | "endDate" | "items">): NightRun[] {
  if (!trip.startDate || !trip.endDate || trip.endDate <= trip.startDate) return [];
  const stays = trip.items.filter((i) => i.kind === "stay" && (i.status === "booked" || i.status === "planned"));
  const runs: NightRun[] = [];
  for (let d = trip.startDate; d < trip.endDate && runs.length < 120; d = addDays(d, 1)) {
    const stay = stays.find((s) => s.startDate <= d && (s.endDate ?? s.startDate) > d) ?? null;
    const last = runs.at(-1);
    if (last && last.stay?.id === stay?.id) runs[runs.length - 1] = { ...last, to: addDays(d, 1), nights: last.nights + 1 };
    else runs.push({ from: d, to: addDays(d, 1), nights: 1, stay });
  }
  return runs;
}

export type Issue = { level: "warn" | "info"; text: string; itemId?: string };

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const BOOK_SOON_DAYS = 7;

/** Things to sort out before the trip, worked out from the plan itself. */
export function issues(trip: Pick<TripDetail, "startDate" | "endDate" | "items">, today: string): Issue[] {
  const out: Issue[] = [];
  if (trip.endDate && trip.endDate < today) return out;
  for (const run of nights(trip)) {
    if (run.stay) continue;
    const span = run.nights === 1 ? `the night of ${short(run.from)}` : `${run.nights} nights, ${short(run.from)} to ${short(run.to)}`;
    out.push({ level: "warn", text: `No place to stay for ${span}.` });
  }
  for (const i of toBook(trip.items)) {
    const by = i.details.bookBy;
    if (by && by < today) out.push({ level: "warn", text: `${i.title} was to be booked by ${short(by)}.`, itemId: i.id });
    else if (by && daysUntil(today, by) <= BOOK_SOON_DAYS) out.push({ level: "warn", text: `Book ${i.title} by ${short(by)}.`, itemId: i.id });
    else if (!by && i.startDate >= today && daysUntil(today, i.startDate) <= 14) out.push({ level: "warn", text: `${i.title} on ${short(i.startDate)} isn't booked yet.`, itemId: i.id });
  }
  const timed = trip.items.filter((i) => live(i) && i.startTime && i.kind !== "stay");
  const seen = new Map<string, Item>();
  for (const i of timed) {
    const key = `${i.startDate} ${i.startTime}`;
    const other = seen.get(key);
    if (other) out.push({ level: "warn", text: `${other.title} and ${i.title} are both at ${i.startTime} on ${short(i.startDate)}.`, itemId: i.id });
    else seen.set(key, i);
  }
  if (trip.startDate && trip.endDate) {
    const busy = new Set(trip.items.filter((i) => live(i) && i.kind !== "stay").map((i) => i.startDate));
    const open: string[] = [];
    for (let d = trip.startDate; d <= trip.endDate && open.length < 60; d = addDays(d, 1)) if (!busy.has(d)) open.push(d);
    if (open.length) out.push({ level: "info", text: `Nothing planned yet on ${open.map(short).join(", ")}.` });
  }
  return out;
}

export type StarterTask = { title: string; section: string };

const BEFORE = "Before you go";
const PACK = "Packing";

const BY_TYPE: Partial<Record<TripType, StarterTask[]>> = {
  beach: [{ title: "Reef-safe sunscreen and swimwear", section: PACK }],
  road: [{ title: "Check tires, oil and wipers", section: BEFORE }, { title: "Download offline maps for the route", section: BEFORE }],
  family: [{ title: "Snacks and entertainment for the travel days", section: PACK }],
  adventure: [{ title: "Check gear and book any guides or permits", section: BEFORE }],
  ski: [{ title: "Book lift tickets and rentals", section: BEFORE }, { title: "Layers, goggles and gloves", section: PACK }],
  business: [{ title: "Laptop, chargers and adapters", section: PACK }],
};

/** A short checklist every new trip starts with; the AI or an agent can add the rest. */
export function starterTasks(type: TripType | null): StarterTask[] {
  return [
    { title: "Check passports or IDs are valid for the trip", section: BEFORE },
    { title: "Tell your bank and set up travel insurance", section: BEFORE },
    { title: "Share the plan with whoever's going", section: BEFORE },
    ...(type ? (BY_TYPE[type] ?? []) : []),
    { title: "Chargers, medications and documents", section: PACK },
  ];
}

/**
 * A day in a line, for its folded heading: "Fly in, Pizzeria Bianco, Penca".
 * Stays and notes are left out (the stay has its own row); flights read as
 * arriving or leaving on the trip's first and last days.
 */
export function daySummary(trip: Pick<TripDetail, "startDate" | "endDate" | "items">, date: string): string {
  return trip.items
    .filter((i) => i.startDate === date && live(i) && i.kind !== "stay" && i.kind !== "note")
    .sort((a, b) => when(a).localeCompare(when(b)))
    .map((i) => {
      if (i.kind !== "flight") return i.title;
      if (date === trip.startDate) return "Fly in";
      if (date === trip.endDate) return "Fly home";
      return i.details.to ? `Fly to ${i.details.to}` : i.title;
    })
    .filter((t, k, all) => all.indexOf(t) === k)
    .join(", ");
}

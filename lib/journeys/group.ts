import { addDays } from "../format";
import type { DraftItem, Item, Journey } from "./types";

// Which trip a batch of items (everything read from one email) belongs to.
// A wrong merge is worse than leaving an item unfiled, so this attaches only
// when exactly one trip fits, and creates a trip only for flights and stays.

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/** One booking's identity across emails: the same flight segment, stay or reservation. Null when it can't be told apart. */
export function dedupeKey(item: DraftItem): string | null {
  if (item.status === "suggested" || item.kind === "note") return null;
  if (item.kind === "flight") {
    const number = item.details.flightNumber ? norm(item.details.flightNumber) : null;
    if (number) return `flight:${number}:${item.startDate}`;
    // Without a number or both airports, two flights that day can't be told apart: never merge them.
    if (!item.details.from || !item.details.to) return null;
    return `flight:${norm(item.details.from)}-${norm(item.details.to)}:${item.startDate}${item.startTime ?? ""}`;
  }
  // One train or transfer booking often covers several legs under the same code: key each leg.
  if (item.kind === "transport") return `transport:${item.confirmation ? `conf:${norm(item.confirmation)}:` : ""}${norm(item.title)}:${item.startDate}${item.startTime ?? ""}`;
  if (item.confirmation) return `${item.kind}:conf:${norm(item.confirmation)}`;
  const at = item.kind === "stay" ? item.startDate : `${item.startDate}${item.startTime ?? ""}`;
  return `${item.kind}:${norm(item.title)}:${at}`;
}

/** Kinds a confirmation can book in place of a stop already in the plan. */
const BOOKABLE = new Set<DraftItem["kind"]>(["dining", "activity"]);

/** "Dinner at Penca" and "Penca", or "The Flying V at Loews Ventana Canyon Resort" and "Flying V". */
const sameName = (a: string, b: string) => {
  const [x, y] = [norm(a), norm(b)].sort((p, q) => p.length - q.length);
  return x.length >= 3 && y.includes(x);
};

const street = (address: string | undefined) => (address ? norm(address.split(",")[0]) : "");

/**
 * Two places that are clearly not the same: a Nobu in New York and one in London.
 * Neighbouring towns aren't a conflict when the street matches or one address names the other's town.
 */
function placesConflict(a: Pick<DraftItem, "place" | "details">, b: Pick<DraftItem, "place" | "details">): boolean {
  if (!a.place || !b.place || sameCity(a.place, b.place)) return false;
  if (street(a.details.address) && street(a.details.address) === street(b.details.address)) return false;
  const names = (address: string | undefined, place: string) => Boolean(address && norm(address).includes(norm(place)));
  return !names(a.details.address, b.place) && !names(b.details.address, a.place);
}

/**
 * The stop in a trip's plan that this confirmation books: same kind, day and
 * town, one name inside the other, and not already holding a different
 * booking. A cancellation only matches a booking. Null when there's none, or
 * more than one and the time doesn't settle it.
 */
export function plannedMatch(incoming: DraftItem, candidates: Item[]): Item | null {
  if (!BOOKABLE.has(incoming.kind) || incoming.status === "suggested") return null;
  const fits = candidates.filter(
    (c) =>
      c.journeyId !== null &&
      c.kind === incoming.kind &&
      (incoming.status === "cancelled" ? c.status === "booked" : c.status !== "cancelled") &&
      c.startDate === incoming.startDate &&
      !(c.confirmation && incoming.confirmation && norm(c.confirmation) !== norm(incoming.confirmation)) &&
      sameName(c.title, incoming.title) &&
      !placesConflict(c, incoming),
  );
  if (fits.length <= 1) return fits[0] ?? null;
  const sameTime = fits.filter((c) => c.startTime === incoming.startTime);
  return sameTime.length === 1 ? sameTime[0] : null;
}

export type Span = { start: string; end: string };

export function spanOf(items: Pick<DraftItem, "startDate" | "endDate">[]): Span | null {
  if (!items.length) return null;
  const starts = items.map((i) => i.startDate).sort();
  const ends = items.map((i) => i.endDate ?? i.startDate).sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

/** Where the batch is headed: the first stay's city, else the first flight's arrival city. */
export function destinationOf(items: DraftItem[]): string | null {
  const sorted = [...items].sort((a, b) => `${a.startDate}${a.startTime ?? ""}`.localeCompare(`${b.startDate}${b.startTime ?? ""}`));
  return sorted.find((i) => i.kind === "stay" && i.place)?.place ?? sorted.find((i) => i.kind === "flight" && i.place)?.place ?? sorted.find((i) => i.place)?.place ?? null;
}

const sameCity = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && (norm(a).includes(norm(b)) || norm(b).includes(norm(a))));

/** Every city the batch touches: where things happen, and for flights both ends. */
function citiesOf(items: DraftItem[], cityOf: (code: string) => string | undefined): string[] {
  const toCity = (v: string | undefined) => (v && /^[A-Z]{3}$/.test(v) ? (cityOf(v) ?? v) : v);
  return items.flatMap((i) => [i.place, i.kind === "flight" ? toCity(i.details.from) : null, i.kind === "flight" ? toCity(i.details.to) : null]).filter((c): c is string => Boolean(c));
}

/** Departure city of a flight, by airport code or name. */
function leavesFrom(item: DraftItem, cityOf: (code: string) => string | undefined): string | undefined {
  const from = item.details.from;
  if (!from) return undefined;
  return /^[A-Z]{3}$/.test(from) ? (cityOf(from) ?? from) : from;
}

export type Placement = { action: "attach"; journeyId: string } | { action: "create"; title: string; destination: string | null; span: Span } | { action: "unfiled" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function journeyTitle(destination: string | null, start: string): string {
  const month = `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
  return destination ? `${destination}, ${month}` : `Trip, ${month}`;
}

/**
 * @param known journeys that already hold one of these bookings (from a dedupe hit)
 * @param cityOf airport code → city, for matching a flight home to a trip's destination
 */
export function placeBatch(items: DraftItem[], journeys: Journey[], known: string[], cityOf: (code: string) => string | undefined): Placement {
  const span = spanOf(items);
  if (!span) return { action: "unfiled" };
  const knownIds = [...new Set(known)];
  if (knownIds.length === 1) return { action: "attach", journeyId: knownIds[0] };
  if (knownIds.length > 1) return { action: "unfiled" };

  const dated = journeys.filter((j): j is Journey & { startDate: string } => Boolean(j.startDate));
  const cities = citiesOf(items, cityOf);
  // Dates alone aren't enough: a Tokyo hotel the day after a Paris trip is a different trip.
  const fits = (j: Journey) => !j.destination || !cities.length || cities.some((c) => sameCity(c, j.destination));
  const nearby = dated.filter((j) => span.start <= addDays(j.endDate ?? j.startDate, 1) && span.end >= addDays(j.startDate, -1));
  const overlapping = nearby.filter(fits);
  // The flight home: leaves the trip's destination within 30 days of its start.
  const homeward = items.every((i) => i.kind === "flight")
    ? dated.filter((j) => {
        const first = [...items].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
        return sameCity(leavesFrom(first, cityOf), j.destination) && span.start > j.startDate && span.start <= addDays(j.startDate, 30);
      })
    : [];
  const candidates = [...new Map([...overlapping, ...homeward].map((j) => [j.id, j])).values()];
  if (candidates.length === 1) return { action: "attach", journeyId: candidates[0].id };
  if (candidates.length > 1) return { action: "unfiled" };
  // It overlaps a trip somewhere else (a multi-city trip, or a mistake): let the traveller decide.
  if (nearby.length) return { action: "unfiled" };

  const live = items.filter((i) => i.status !== "cancelled");
  if (!live.some((i) => i.kind === "flight" || i.kind === "stay")) return { action: "unfiled" };
  const destination = destinationOf(live);
  return { action: "create", title: journeyTitle(destination, span.start), destination, span: spanOf(live) ?? span };
}

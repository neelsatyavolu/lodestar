import { byItinerary } from "./locate";
import type { Item } from "./types";

// Flights in the itinerary: reading a flight's number and airports from what
// sources and agents wrote, and folding the "SFO Terminal 1" / "Land at PHX"
// stops that sit around it into the flight's own card.

/** How long before departure an airport stop still belongs to the flight. */
const BEFORE_MIN = 4 * 60;
/** How long after landing an arrival stop still belongs to the flight. */
const AFTER_MIN = 2 * 60;

const IATA = /\b([A-Z]{3})\b/;

/** "WN 4623" → { airline: "WN", number: "4623" }, from details or the title; null when there's none. */
export function flightCode(item: Pick<Item, "title" | "details">): { airline: string; number: string } | null {
  for (const text of [item.details.flightNumber, item.title]) {
    const m = text?.toUpperCase().match(/\b([A-Z][A-Z0-9]|[A-Z0-9][A-Z])\s?(\d{1,4})[A-Z]?\b/);
    if (m) return { airline: m[1], number: m[2] };
  }
  return null;
}

/** The IATA codes a flight leaves from and lands at: details first, then "SFO → PHX" in the title. */
export function flightAirports(item: Pick<Item, "title" | "details">): { from: string | null; to: string | null } {
  // Codes are written in capitals; a bare "sfo" is the only lowercase form taken.
  const code = (s: string | undefined) => (s && /^[a-z]{3}$/i.test(s.trim()) ? s.trim().toUpperCase() : (s?.match(IATA)?.[1] ?? null));
  let from = code(item.details.from);
  let to = code(item.details.to);
  if (!from || !to) {
    const m = item.title.match(/\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b/);
    from ??= m?.[1] ?? null;
    to ??= m?.[2] ?? null;
  }
  return { from, to };
}

const minutes = (hhmm: string | null) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);

const mentions = (i: Item, code: string) => {
  const word = new RegExp(`\\b${code}\\b`, "i");
  if (word.test(i.title)) return true;
  // "Terminal 4 parking" whose address names the airport.
  return /\b(airport|terminal)\b/i.test(i.title) && word.test(`${i.place ?? ""} ${i.details.address ?? ""}`);
};

const live = (i: Item) => i.status !== "cancelled" && i.status !== "suggested";
const canFold = (i: Item) => live(i) && i.kind !== "flight" && i.kind !== "note" && i.kind !== "stay";

/** The closest stop on `date` naming `code` whose time falls in [lo, hi] minutes; a stop without a time counts. */
function nearest(items: Item[], date: string, code: string | null, lo: number, hi: number, target: number, taken: Set<string>): Item | null {
  if (!code) return null;
  const fits = items.filter((i) => i.startDate === date && canFold(i) && !taken.has(i.id) && mentions(i, code)).filter((i) => {
    const t = minutes(i.startTime);
    return t === null || (t >= lo && t <= hi);
  });
  fits.sort((a, b) => Math.abs((minutes(a.startTime) ?? target) - target) - Math.abs((minutes(b.startTime) ?? target) - target));
  return fits[0] ?? null;
}

export type FlightGroup = { flight: Item; departure: Item | null; arrival: Item | null };

/**
 * Each live flight with the airport stops it absorbs: one before departure at
 * the airport it leaves from, one after landing at the airport it lands at.
 */
export function flightGroups(items: Item[]): FlightGroup[] {
  const taken = new Set<string>();
  return items
    .filter((i) => i.kind === "flight" && live(i))
    .sort(byItinerary)
    .map((flight) => {
      const { from, to } = flightAirports(flight);
      const dep = minutes(flight.startTime);
      const arr = minutes(flight.endTime);
      const departure = dep === null ? null : nearest(items, flight.startDate, from, dep - BEFORE_MIN, dep, dep, taken);
      if (departure) taken.add(departure.id);
      const arrival = arr === null ? null : nearest(items, flight.endDate ?? flight.startDate, to, arr, arr + AFTER_MIN, arr, taken);
      if (arrival) taken.add(arrival.id);
      return { flight, departure, arrival };
    });
}

/** Ids of the stops a flight card shows instead of their own cards. */
export const foldedIds = (groups: FlightGroup[]) => new Set(groups.flatMap((g) => [g.departure?.id, g.arrival?.id]).filter((id): id is string => Boolean(id)));

/** True when a flight takes off between two stops on `date`, so driving between them makes no sense. */
export function flightBetween(items: Item[], date: string, a: Item, b: Item): boolean {
  const lo = minutes(a.startTime);
  const hi = minutes(b.startTime);
  return items.some((f) => {
    if (f.kind !== "flight" || !live(f) || f.startDate !== date) return false;
    const t = minutes(f.startTime);
    // Without times, the itinerary order (a before b) is all there is: any flight that day counts.
    return t === null || lo === null || hi === null ? true : t >= lo && t <= hi;
  });
}

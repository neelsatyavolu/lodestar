import "server-only";
import { airport, distanceKm, expandCode, nearbyAirports, positioningAirports } from "./airports";
import { FaresError, searchDates, searchFlights, type FlightsParams } from "./fares";
import {
  cabinHack,
  flexHack,
  groupHack,
  isRedEye,
  lengthHack,
  matchesRequest,
  nearbyHack,
  nextCabin,
  nonstopHack,
  positionHack,
  rank,
  splitHack,
  stopoverHack,
  throwawayHack,
  timingHack,
  ulccWarning,
  type Hack,
  type Ranked,
} from "./hacks";
import type { DayPrice, Itinerary, SearchQuery } from "./types";

const MAX_AIRPORTS = 6;
// Extra searches for hacks may take this long before their cards are dropped.
const EXTRA_MS = 10_000;
// Extras only need the cheapest option, so they expand fewer outbound flights.
const EXTRA_EXPAND = 2;
const FLEX_DAYS = 3;

export type SearchResult = {
  airports: { from: string[]; to: string[]; nearbyFrom: string[]; nearbyTo: string[] };
  /** Cheapest fare between exactly the requested airports, for comparing hacks. */
  baseline: number | null;
  itineraries: Itinerary[];
  labels: Ranked;
  hacks: Hack[];
  calendar: DayPrice[];
  oneWays: { out: Itinerary[]; back: Itinerary[] } | null;
  warnings: string[];
};

export function resolveCodes(codes: string[]): string[] {
  const out = [...new Set(codes.flatMap((c) => {
    const expanded = expandCode(c);
    if (!expanded.length) throw new FaresError(`We don't know the airport ${c}.`, 400);
    return expanded;
  }))];
  return out.slice(0, MAX_AIRPORTS);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function minKm(code: string, anchors: string[]): number | null {
  const a = airport(code);
  const xs = anchors.map(airport).filter((x) => x !== undefined);
  if (!a || !xs.length) return null;
  return Math.min(...xs.map((x) => distanceKm(x, a)));
}

function settledValue<T>(r: PromiseSettledResult<T> | undefined, label: string, warnings: string[]): T | null {
  if (!r) return null;
  if (r.status === "fulfilled") return r.value;
  warnings.push(`${label}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
  return null;
}

function validated(q: SearchQuery): { from: string[]; to: string[] } {
  const from = resolveCodes(q.from);
  const to = resolveCodes(q.to);
  if (from.some((c) => to.includes(c))) throw new FaresError("From and to are the same place.", 400);
  // "Today" is UTC on the server; allow one day back so evening searches in the Americas still work.
  if (q.depart < addDays(today(), -1)) throw new FaresError("That departure date has passed.", 400);
  return { from, to };
}

/**
 * Drops red-eyes and self-transfers when the traveller asked to avoid them,
 * but never empties the results: then everything stays, with a note.
 */
export function applyAvoidances(items: Itinerary[], q: Pick<SearchQuery, "avoidRedEyes" | "avoidSelfTransfer">, warnings: string[]): Itinerary[] {
  let out = items;
  const drop = (keep: (it: Itinerary) => boolean, what: string) => {
    const kept = out.filter(keep);
    if (kept.length) out = kept;
    else if (out.length) warnings.push(`Only ${what} were found, so they are shown anyway`);
  };
  if (q.avoidSelfTransfer) drop((it) => !it.slices.some((s) => s.self_transfer), "self-transfer itineraries");
  if (q.avoidRedEyes) drop((it) => !isRedEye(it), "red-eye flights");
  return out;
}

type Airports = { from: string[]; to: string[]; allFrom: string[]; allTo: string[] };
type Extras = {
  cabin: Promise<Itinerary[]> | null;
  position: Promise<Itinerary[]> | null;
  lengths: { ret: string; items: Promise<Itinerary[]> }[];
  single: Promise<Itinerary[]> | null;
  roundTrip: { ret: string; items: Promise<Itinerary[]> } | null;
  positionFrom: string[];
};

/** Starts the extra searches the hacks need, alongside the main search. */
function startExtras(q: SearchQuery, base: Omit<FlightsParams, "origins" | "destinations" | "depart">, a: Airports, signal?: AbortSignal): Extras {
  const run = (p: Partial<FlightsParams>) =>
    withDeadline(searchFlights({ ...base, origins: a.allFrom, destinations: a.allTo, depart: q.depart, returnDate: q.return, expand: EXTRA_EXPAND, ...p }, signal), EXTRA_MS, "extra search");
  const up = nextCabin(q.cabin);
  const positionFrom = positioningAirports(a.from).map((x) => x.code).filter((c) => !a.allFrom.includes(c) && !a.allTo.includes(c));
  const lengths = q.return
    ? [addDays(q.return, -1), addDays(q.return, 1)].filter((r) => r >= q.depart).map((ret) => ({ ret, items: run({ returnDate: ret }) }))
    : [];
  const throwawayReturn = addDays(q.depart, 7);
  return {
    cabin: up ? run({ cabin: up }) : null,
    position: positionFrom.length ? run({ origins: positionFrom, destinations: a.to }) : null,
    lengths,
    single: q.adults > 1 && q.children === 0 ? run({ adults: 1 }) : null,
    roundTrip: q.return ? null : { ret: throwawayReturn, items: run({ returnDate: throwawayReturn }) },
    positionFrom,
  };
}

async function settle(p: Promise<Itinerary[]> | null, q: SearchQuery): Promise<Itinerary[]> {
  if (!p) return [];
  try {
    return applyAvoidances(await p, q, []);
  } catch {
    return []; // slow or failed: that hack just doesn't show
  }
}

/** Waits (up to the deadline) for the extra searches and turns them into hacks. */
async function finishExtras(x: Extras, q: SearchQuery, main: Itinerary[], baseline: number | null, from: string[]): Promise<(Hack | null)[]> {
  const [cabin, position, single, lengths, roundTrip] = await Promise.all([
    settle(x.cabin, q),
    settle(x.position, q),
    settle(x.single, q),
    Promise.all(x.lengths.map(async (l) => ({ ret: l.ret, items: await settle(l.items, q) }))),
    x.roundTrip ? settle(x.roundTrip.items, q) : Promise.resolve([]),
  ]);
  const cheapestMain = main.reduce<number | null>((m, it) => (m === null || it.price < m ? it.price : m), null);
  return [
    cabinHack(main, cabin, q.cabin),
    positionHack(baseline, position, (c) => minKm(c, from)),
    q.return ? lengthHack(cheapestMain, lengths, q.return) : null,
    groupHack(main, single, q.adults),
    x.roundTrip ? throwawayHack(main, roundTrip, x.roundTrip.ret) : null,
  ];
}

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FaresError(`${what} took too long`, 504)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** Lowest fare per departure day, three days either side, same trip length. Google can be slow here. */
export const MAX_CALENDAR_DAYS = 62;

/**
 * Lowest fare per departure day, same trip length. By default three days
 * either side of the chosen date; with `window`, any span up to two months
 * (the picker's visible months). Google can be slow here.
 */
export async function runCalendar(q: SearchQuery, signal?: AbortSignal, window?: { start: string; end: string }): Promise<DayPrice[]> {
  const { from, to } = validated(q);
  const tomorrow = addDays(today(), 1);
  const wantedStart = window?.start ?? addDays(q.depart, -FLEX_DAYS);
  const start = wantedStart > tomorrow ? wantedStart : tomorrow;
  const wantedEnd = window?.end ?? addDays(q.depart, FLEX_DAYS);
  const cap = addDays(start, MAX_CALENDAR_DAYS - 1);
  const end = wantedEnd < cap ? wantedEnd : cap;
  if (end < start) return [];
  const tripDays = q.return ? Math.round((Date.parse(q.return) - Date.parse(q.depart)) / 86_400_000) : null;
  // Google's calendar has no same-day round trips; a one-way calendar would not compare.
  if (tripDays === 0) return [];
  return searchDates(
    { origins: from, destinations: to, start, end, tripDays, cabin: q.cabin, maxStops: q.stops, adults: q.adults, children: q.children, alliances: q.alliances, excludeAirlines: q.avoidAirlines },
    signal,
  );
}

/**
 * Live fares plus hacks. The date calendar is slow and optional: the web app
 * fetches it separately (runCalendar); callers that want it inline pass
 * `calendarMs` and get whatever arrives within that time.
 */
export async function runSearch(q: SearchQuery, signal?: AbortSignal, opts: { calendarMs?: number } = {}): Promise<SearchResult> {
  const { from, to } = validated(q);

  // On short trips (SFO→SJC, LHR→STN) the two sides share neighbours; an airport
  // may only sit on one side or Google rejects the search.
  const nearbyTo = q.nearby ? nearbyAirports(to).map((a) => a.code).filter((c) => !from.includes(c)) : [];
  const nearbyFrom = q.nearby ? nearbyAirports(from).map((a) => a.code).filter((c) => !to.includes(c) && !nearbyTo.includes(c)) : [];
  const allFrom = [...from, ...nearbyFrom].slice(0, MAX_AIRPORTS);
  const allTo = [...to, ...nearbyTo].slice(0, MAX_AIRPORTS);

  const base: Omit<FlightsParams, "origins" | "destinations" | "depart"> = {
    cabin: q.cabin,
    maxStops: q.stops,
    adults: q.adults,
    children: q.children,
    bags: q.bags,
    alliances: q.alliances,
    excludeAirlines: q.avoidAirlines,
    excludeBasic: q.noBasicEconomy,
  };

  const main = searchFlights({ ...base, origins: allFrom, destinations: allTo, depart: q.depart, returnDate: q.return }, signal);
  const dates = q.flexible && opts.calendarMs ? withDeadline(runCalendar(q, signal), opts.calendarMs, "Flexible dates") : null;
  const split = q.return && q.split
    ? [
        searchFlights({ ...base, origins: allFrom, destinations: allTo, depart: q.depart }, signal),
        searchFlights({ ...base, origins: allTo, destinations: allFrom, depart: q.return }, signal),
      ]
    : null;

  const extras = startExtras(q, base, { from, to, allFrom, allTo }, signal);

  const [mainR, datesR, outR, backR] = await Promise.allSettled([main, dates ?? Promise.resolve(null), ...(split ?? [])]);
  if (mainR.status === "rejected") throw mainR.reason;
  const warnings: string[] = [];
  const itineraries = applyAvoidances(mainR.value, q, warnings);
  const calendar = settledValue(datesR, "Flexible dates", warnings) ?? [];
  const quiet: string[] = [];
  const outRaw = settledValue(outR, "One-way outbound", warnings);
  const backRaw = settledValue(backR, "One-way return", warnings);
  const out = outRaw && applyAvoidances(outRaw, q, quiet);
  const back = backRaw && applyAvoidances(backRaw, q, quiet);

  const { ordered, labels } = rank(itineraries, new Set(q.preferAirlines));
  const baseline = itineraries.filter((it) => matchesRequest(it, from, to)).reduce<number | null>((m, it) => (m === null || it.price < m ? it.price : m), null);
  const hacks = [
    nearbyHack(itineraries, from, to, (c) => minKm(c, nearbyFrom.includes(c) ? from : to)),
    // The calendar ignores bag fees, so only fall back to a bag-inclusive baseline when there are no bags.
    flexHack(calendar, q.depart, q.return, q.bags ? null : baseline),
    out && back ? splitHack(itineraries, out, back) : null,
    nonstopHack(itineraries),
    ulccWarning(itineraries),
    timingHack(itineraries),
    stopoverHack(itineraries),
    ...(await finishExtras(extras, q, itineraries, baseline, from)),
  ].filter((h): h is Hack => h !== null);

  return {
    airports: { from, to, nearbyFrom, nearbyTo },
    baseline,
    itineraries: ordered,
    labels,
    hacks: hacks.sort((a, b) => b.saving - a.saving),
    calendar,
    oneWays: out && back ? { out, back } : null,
    warnings,
  };
}

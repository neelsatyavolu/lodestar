import { ULTRA_LOW_COST, airlineName } from "./airlines";
import { stopoverFor } from "./stopovers";
import type { DayPrice, Itinerary, SearchQueryInput } from "./types";

// Travel hacks computed from real search results. Each one compares against a
// baseline (the cheapest fare that matches exactly what the traveller asked
// for) and only appears when it saves at least MIN_SAVING.

export const MIN_SAVING = 15;

export type HackKind = "nearby" | "flex" | "split" | "nonstop" | "ulcc" | "cabin" | "position" | "length" | "group" | "throwaway" | "timing" | "stopover";

export type Hack = {
  kind: HackKind;
  title: string;
  detail: string;
  /** Dollars saved vs the baseline; negative means it costs more (nonstop upgrade). */
  saving: number;
  price: number;
  itineraryIds: string[];
  /** Search changes that reproduce this option. */
  apply?: Partial<SearchQueryInput>;
  caution?: string;
};

export function endpoints(it: Itinerary, slice = 0): { from: string; to: string } {
  const s = it.slices[slice];
  return { from: s.legs[0].from, to: s.legs[s.legs.length - 1].to };
}

/** Does every slice start and end at the airports the traveller asked for? */
export function matchesRequest(it: Itinerary, from: string[], to: string[]): boolean {
  const out = endpoints(it, 0);
  if (!from.includes(out.from) || !to.includes(out.to)) return false;
  if (it.slices.length > 1) {
    const back = endpoints(it, 1);
    if (!to.includes(back.from) || !from.includes(back.to)) return false;
  }
  return true;
}

export function totalMinutes(it: Itinerary): number {
  return it.slices.reduce((sum, s) => sum + s.minutes, 0);
}

export function totalStops(it: Itinerary): number {
  return it.slices.reduce((sum, s) => sum + s.stops, 0);
}

function cheapest(items: Itinerary[]): Itinerary | undefined {
  return items.reduce<Itinerary | undefined>((best, it) => (!best || it.price < best.price ? it : best), undefined);
}

/**
 * Lower is better: price, plus a value of time and comfort. $25 per extra
 * hour over the fastest option, $35 per stop, $120 for a self-transfer
 * (you re-check bags and nobody protects the connection), $30 per overnight layover.
 */
export function bestScore(it: Itinerary, fastestMinutes: number): number {
  const extraHours = Math.max(0, totalMinutes(it) - fastestMinutes) / 60;
  const selfTransfer = it.slices.some((s) => s.self_transfer) ? 120 : 0;
  const overnights = it.slices.flatMap((s) => s.layovers).filter((l) => l.overnight).length;
  return it.price + extraHours * 25 + totalStops(it) * 35 + selfTransfer + overnights * 30;
}

export type Ranked = { cheapest?: string; fastest?: string; best?: string };

/** Some slice leaves at 9pm or later and lands the next day, or leaves before 5am. Times are local. */
export function isRedEye(it: Itinerary): boolean {
  return it.slices.some((s) => {
    const first = s.legs[0];
    const last = s.legs[s.legs.length - 1];
    const hour = Number(first.depart.slice(11, 13));
    const landsNextDay = last.arrive.slice(0, 10) > first.depart.slice(0, 10);
    return (hour >= 21 && landsNextDay) || hour < 5;
  });
}

/** Every flight in the itinerary is on one of these airlines. */
export function allOn(it: Itinerary, airlines: Set<string>): boolean {
  return airlines.size > 0 && it.slices.every((s) => s.legs.every((l) => airlines.has(l.airline.code)));
}

// Worth about this much to a traveller who prefers the airline (status, miles).
const PREFERRED_AIRLINE_BONUS = 40;

export function rank(items: Itinerary[], prefer: Set<string> = new Set()): { ordered: Itinerary[]; labels: Ranked } {
  if (!items.length) return { ordered: [], labels: {} };
  const fastestMinutes = Math.min(...items.map(totalMinutes));
  const scored = items.map((it) => ({ it, score: bestScore(it, fastestMinutes) - (allOn(it, prefer) ? PREFERRED_AIRLINE_BONUS : 0) }));
  const ordered = [...scored].sort((a, b) => a.score - b.score).map((s) => s.it);
  const fastest = [...items].sort((a, b) => totalMinutes(a) - totalMinutes(b) || a.price - b.price)[0];
  return { ordered, labels: { best: ordered[0].id, cheapest: cheapest(items)?.id, fastest: fastest.id } };
}

export function nearbyHack(items: Itinerary[], from: string[], to: string[], kmFor: (code: string) => number | null): Hack | null {
  const baseline = cheapest(items.filter((it) => matchesRequest(it, from, to)));
  const alt = cheapest(items.filter((it) => !matchesRequest(it, from, to)));
  // Without a fare from the requested airports there is nothing honest to compare against.
  if (!alt || !baseline) return null;
  const saving = baseline.price - alt.price;
  if (saving < MIN_SAVING) return null;
  const { from: af, to: at } = endpoints(alt);
  // Check every slice: a round trip can differ only on the way back (out SFO→JFK, back EWR→SFO).
  const used = alt.slices.flatMap((_, i) => {
    const e = endpoints(alt, i);
    return i === 0 ? [e.from, e.to] : [e.to, e.from];
  });
  const changed = [...new Set(used.filter((c) => !from.includes(c) && !to.includes(c)))];
  const distances = changed.map((c) => {
    const km = kmFor(c);
    return km === null ? c : `${c} is ${Math.round(km)} km away`;
  });
  return {
    kind: "nearby",
    title: `Use ${changed.join(" and ")} instead`,
    detail: `${af} → ${at} is $${Math.round(saving)} less than the cheapest fare between your airports. ${distances.join("; ")}.`,
    saving: Math.round(saving),
    price: alt.price,
    itineraryIds: [alt.id],
    caution: "Count the cost and time of getting to a different airport.",
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export function shortDate(iso: string): string {
  return WEEKDAY.format(new Date(`${iso}T12:00:00Z`));
}

export function flexHack(days: DayPrice[], depart: string, returnDate: string | null, baselinePrice: number | null): Hack | null {
  if (!days.length) return null;
  const chosen = days.find((d) => d.depart === depart)?.price ?? baselinePrice;
  if (chosen === null || chosen === undefined) return null;
  const best = days.reduce((a, b) => (b.price < a.price ? b : a));
  const saving = chosen - best.price;
  if (best.depart === depart || saving < MIN_SAVING) return null;
  const shift = daysBetween(depart, best.depart);
  const newReturn = returnDate ? (best.return ?? addDays(returnDate, shift)) : null;
  const when = newReturn ? `${shortDate(best.depart)} – ${shortDate(newReturn)}` : shortDate(best.depart);
  return {
    kind: "flex",
    title: `${shift < 0 ? "Leave" : "Go"} ${Math.abs(shift)} day${Math.abs(shift) === 1 ? "" : "s"} ${shift < 0 ? "earlier" : "later"}`,
    detail: `${when} is $${Math.round(saving)} less than your dates.`,
    saving: Math.round(saving),
    price: best.price,
    itineraryIds: [],
    apply: { depart: best.depart, return: newReturn },
  };
}

export function splitHack(roundTrips: Itinerary[], outbound: Itinerary[], inbound: Itinerary[]): Hack | null {
  const rt = cheapest(roundTrips);
  const out = cheapest(outbound);
  const back = cheapest(inbound);
  if (!out || !back) return null;
  const sum = out.price + back.price;
  const saving = rt ? rt.price - sum : 0;
  if (rt && saving < MIN_SAVING) return null;
  const outAir = out.slices[0].legs[0].airline.name;
  const backAir = back.slices[0].legs[0].airline.name;
  return {
    kind: "split",
    title: "Book two one-way tickets",
    detail: rt
      ? `${outAir} out and ${backAir} back costs $${Math.round(sum)} together, $${Math.round(saving)} less than the cheapest round trip.`
      : `No round-trip fare was listed; two one-ways cost $${Math.round(sum)}.`,
    saving: Math.round(saving),
    price: sum,
    itineraryIds: [out.id, back.id],
    caution: "Two separate tickets: a change or cancellation on one does not carry over to the other.",
  };
}

export function nonstopHack(items: Itinerary[]): Hack | null {
  const low = cheapest(items);
  const nonstop = cheapest(items.filter((it) => totalStops(it) === 0));
  if (!low || !nonstop || nonstop.id === low.id || totalStops(low) === 0) return null;
  const extra = nonstop.price - low.price;
  const hoursSaved = (totalMinutes(low) - totalMinutes(nonstop)) / 60;
  if (extra > 60 || hoursSaved < 1) return null;
  return {
    kind: "nonstop",
    title: `Nonstop for $${Math.round(extra)} more`,
    detail: `Skips the connection and saves about ${Math.round(hoursSaved * 10) / 10} hours.`,
    saving: -Math.round(extra),
    price: nonstop.price,
    itineraryIds: [nonstop.id],
  };
}

export function ulccWarning(items: Itinerary[]): Hack | null {
  const low = cheapest(items);
  if (!low) return null;
  const carriers = new Set(low.slices.flatMap((s) => s.legs.map((l) => l.airline.code)));
  const ulcc = [...carriers].find((c) => ULTRA_LOW_COST.has(c));
  if (!ulcc) return null;
  return {
    kind: "ulcc",
    title: "The cheapest fare is a no-frills airline",
    detail: "Its headline price usually leaves out a carry-on bag and seat choice. Check sellers to see the real cost with bags.",
    saving: 0,
    price: low.price,
    itineraryIds: [low.id],
  };
}

// ---- Hacks that need an extra search (run alongside the main one) ----

const NEXT_CABIN: Record<string, "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST" | undefined> = {
  ECONOMY: "PREMIUM_ECONOMY",
  PREMIUM_ECONOMY: "BUSINESS",
  BUSINESS: "FIRST",
};
const CABIN_NAME: Record<string, string> = { PREMIUM_ECONOMY: "Premium economy", BUSINESS: "Business", FIRST: "First" };

export function nextCabin(cabin: string): "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST" | null {
  return NEXT_CABIN[cabin] ?? null;
}

/** The next cabin up, when it costs at most a quarter more (or $60, whichever is larger). */
export function cabinHack(base: Itinerary[], upgraded: Itinerary[], cabin: string): Hack | null {
  const low = cheapest(base);
  const up = cheapest(upgraded);
  const next = nextCabin(cabin);
  if (!low || !up || !next) return null;
  const extra = up.price - low.price;
  if (extra > Math.max(60, low.price * 0.25)) return null;
  return {
    kind: "cabin",
    title: extra <= 0 ? `${CABIN_NAME[next]} costs the same` : `${CABIN_NAME[next]} for $${Math.round(extra)} more`,
    detail: `The cheapest ${CABIN_NAME[next].toLowerCase()} fare is ${extra <= 0 ? "no more than" : `only ${Math.round((extra / low.price) * 100)}% above`} the cheapest in your cabin.`,
    saving: -Math.max(0, Math.round(extra)),
    price: up.price,
    itineraryIds: [up.id],
    apply: { cabin: next },
  };
}

/** Driving to a bigger airport further away, when the saving covers the trip. */
export function positionHack(baseline: number | null, hubItins: Itinerary[], kmFor: (code: string) => number | null): Hack | null {
  const alt = cheapest(hubItins);
  if (!alt || baseline === null) return null;
  const saving = baseline - alt.price;
  if (saving < 60) return null;
  const code = endpoints(alt).from;
  const km = kmFor(code);
  return {
    kind: "position",
    title: `Start from ${code}`,
    detail: `Flights from ${code}${km ? `, about ${Math.round(km)} km away,` : ""} are $${Math.round(saving)} less than from your airports.`,
    saving: Math.round(saving),
    price: alt.price,
    itineraryIds: [alt.id],
    apply: { from: [code] },
    caution: "Worth it only if getting there is easy: count fuel, parking or a train ticket.",
  };
}

/** Coming back a day earlier or later, for round trips. */
export function lengthHack(baseline: number | null, options: { ret: string; items: Itinerary[] }[], currentReturn: string): Hack | null {
  if (baseline === null) return null;
  const best = options
    .map((o) => ({ ...o, low: cheapest(o.items) }))
    .filter((o): o is { ret: string; items: Itinerary[]; low: Itinerary } => Boolean(o.low))
    .sort((a, b) => a.low.price - b.low.price)[0];
  if (!best) return null;
  const saving = baseline - best.low.price;
  if (saving < MIN_SAVING) return null;
  const later = best.ret > currentReturn;
  return {
    kind: "length",
    title: `Come back a day ${later ? "later" : "earlier"}`,
    detail: `Returning ${shortDate(best.ret)} instead of ${shortDate(currentReturn)} is $${Math.round(saving)} less.`,
    saving: Math.round(saving),
    price: best.low.price,
    itineraryIds: [best.low.id],
    apply: { return: best.ret },
  };
}

/**
 * Airlines price a group at the fare bucket that has seats for everyone. When
 * one seat is cheaper, booking travellers one at a time can cost less.
 */
export function groupHack(group: Itinerary[], single: Itinerary[], adults: number): Hack | null {
  const together = cheapest(group);
  const one = cheapest(single);
  if (!together || !one || adults < 2) return null;
  const separate = one.price * adults;
  const saving = together.price - separate;
  if (saving < MIN_SAVING * adults) return null;
  return {
    kind: "group",
    title: `Book the ${adults} tickets one at a time`,
    detail: `One seat is $${Math.round(one.price)}, so ${adults} separate bookings come to $${Math.round(separate)} against $${Math.round(together.price)} together.`,
    saving: Math.round(saving),
    price: separate,
    itineraryIds: [one.id],
    apply: { adults: 1 },
    caution: "Separate bookings are separate records: link them with the airline so you can sit together, and check seats are still there for everyone.",
  };
}

/** A round trip sometimes costs less than the one-way. */
export function throwawayHack(oneWay: Itinerary[], roundTrips: Itinerary[], returnDate: string): Hack | null {
  const ow = cheapest(oneWay);
  const rt = cheapest(roundTrips);
  if (!ow || !rt) return null;
  const saving = ow.price - rt.price;
  if (saving < 30) return null;
  return {
    kind: "throwaway",
    title: "A round trip is cheaper than one way",
    detail: `A round trip returning ${shortDate(returnDate)} is $${Math.round(saving)} less than the one-way. Useful if you might come back anyway.`,
    saving: Math.round(saving),
    price: rt.price,
    itineraryIds: [rt.id],
    apply: { return: returnDate },
    caution: "Skipping the return is against most airlines' rules and can cost miles or status. Never skip an outbound or connecting flight: the rest of the ticket gets cancelled.",
  };
}

// ---- Hacks read straight from the results ----

/** What an overnight or very early flight saves over the cheapest daytime one. */
export function timingHack(items: Itinerary[]): Hack | null {
  const low = cheapest(items);
  if (!low || !isRedEye(low)) return null;
  const day = cheapest(items.filter((it) => !isRedEye(it)));
  const saving = day ? day.price - low.price : 0;
  if (!day || saving < MIN_SAVING) return null;
  return {
    kind: "timing",
    title: `Flying overnight saves $${Math.round(saving)}`,
    detail: `The cheapest fare leaves late at night or before 5am. The cheapest daytime departure is $${Math.round(day.price)}.`,
    saving: Math.round(saving),
    price: low.price,
    itineraryIds: [low.id],
    caution: "Turn on Avoid red-eyes in preferences if you'd rather not see these first.",
  };
}

/** A connection through an airline hub with a stopover program can become a free stay. */
export function stopoverHack(items: Itinerary[]): Hack | null {
  for (const it of [...items].sort((a, b) => a.price - b.price).slice(0, 8)) {
    for (const s of it.slices) {
      for (let i = 0; i < s.legs.length - 1; i++) {
        const leg = s.legs[i];
        const program = stopoverFor(leg.airline.code, leg.to);
        if (!program) continue;
        return {
          kind: "stopover",
          title: `Turn the ${program.city} connection into a stay`,
          detail: `${airlineName(leg.airline.code, program.name)} offers ${program.offer}. This $${Math.round(it.price)} itinerary already connects there.`,
          saving: 0,
          price: it.price,
          itineraryIds: [it.id],
          caution: `${program.rules} Confirm with the airline when booking.`,
        };
      }
    }
  }
  return null;
}

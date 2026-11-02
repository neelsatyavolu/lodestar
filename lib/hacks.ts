import { ULTRA_LOW_COST } from "./airlines";
import type { DayPrice, Itinerary, SearchQueryInput } from "./types";

// Travel hacks computed from real search results. Each one compares against a
// baseline (the cheapest fare that matches exactly what the traveller asked
// for) and only appears when it saves at least MIN_SAVING.

export const MIN_SAVING = 15;

export type HackKind = "nearby" | "flex" | "split" | "nonstop" | "ulcc";

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

export function rank(items: Itinerary[]): { ordered: Itinerary[]; labels: Ranked } {
  if (!items.length) return { ordered: [], labels: {} };
  const fastestMinutes = Math.min(...items.map(totalMinutes));
  const scored = items.map((it) => ({ it, score: bestScore(it, fastestMinutes) }));
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

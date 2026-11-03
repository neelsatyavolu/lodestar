import { airport } from "../airports";
import type { LatLng } from "../places/types";
import type { Item, JourneyWithItems } from "./types";

// Which items still need a pin on the map, and what to search for each.
// Flights pin to their arrival airport from our own airport data (free);
// everything else is looked up by name, address and city.

/** Google allows keeping coordinates for 30 days; look them up again after that. */
export const LOCATION_TTL_MS = 30 * 86_400_000;
/** A lookup that found nothing is tried again after a week, not on every visit. */
export const RETRY_FAILED_MS = 7 * 86_400_000;
export const MAX_LOCATE = 12;

export type Lookup = { id: string; title: string; address: string | null; city: string | null } | { id: string; location: LatLng };

/**
 * Itinerary order within a day: by time. Something without a time was added to the day, so it
 * follows the timed plans; a stay without a time is check-in, which ends the day.
 */
export function byItinerary(a: Item, b: Item): number {
  const at = (i: Item) => i.startTime ?? (i.kind === "stay" ? "99:99" : "98:00");
  return `${a.startDate}${at(a)}`.localeCompare(`${b.startDate}${at(b)}`);
}

const located = (i: Item) => i.details.lat !== undefined && i.details.lng !== undefined;

export function needsLocation(item: Item, now: number): boolean {
  if (item.status === "cancelled" || item.kind === "note") return false;
  const d = item.details;
  // Looked for lately and not found (or a stale pin not refreshed): wait out the week.
  if ((d.locateFailedAt ?? 0) >= now - RETRY_FAILED_MS) return false;
  if (!located(item)) return true;
  return d.placeId?.startsWith("g:") === true && (d.locatedAt ?? 0) < now - LOCATION_TTL_MS;
}

/** Everything still to pin, flights first (they need no search). */
export function pendingLookups(j: JourneyWithItems, now: number): Lookup[] {
  const out: Lookup[] = [];
  for (const item of j.items) {
    if (!needsLocation(item, now)) continue;
    if (item.kind === "flight") {
      const code = item.details.to;
      const a = code && /^[A-Z]{3}$/.test(code) ? airport(code) : undefined;
      if (a) out.unshift({ id: item.id, location: { lat: a.lat, lng: a.lon } });
      continue;
    }
    if (item.kind === "transport" && !item.details.address) continue;
    out.push({ id: item.id, title: item.title, address: item.details.address ?? null, city: item.place ?? j.destination });
  }
  return out;
}

/** One round of lookups: a locate call does at most this many. */
export const lookupsFor = (j: JourneyWithItems, now: number) => pendingLookups(j, now).slice(0, MAX_LOCATE);

function center(items: Item[]): LatLng | null {
  if (!items.length) return null;
  return { lat: items.reduce((s, i) => s + i.details.lat!, 0) / items.length, lng: items.reduce((s, i) => s + i.details.lng!, 0) / items.length };
}

/**
 * Where to search from when adding a place on `date`: that day's stops, else the trip's other
 * stops, else where the first flight lands. Flights home don't count, or a Tucson trip from
 * San Francisco would search from Nevada.
 */
export function searchCenter(items: Item[], date: string | null): LatLng | null {
  const pinned = items.filter((i) => located(i) && i.status !== "cancelled");
  const places = pinned.filter((i) => i.kind !== "flight");
  const today = places.filter((i) => i.startDate === date || (i.kind === "stay" && date !== null && i.startDate <= date && (i.endDate ?? i.startDate) >= date));
  if (today.length) return center(today);
  if (places.length) return center(places);
  const [arrival] = pinned.filter((i) => i.kind === "flight").sort(byItinerary);
  return arrival ? center([arrival]) : null;
}

/** A day's stops in order, for drive times: located, not cancelled, not ideas, not flights. */
export function dayStops(items: Item[], date: string): Item[] {
  return items
    .filter((i) => i.startDate === date && i.status !== "cancelled" && i.status !== "suggested" && i.kind !== "flight" && i.kind !== "note" && located(i))
    .sort(byItinerary);
}

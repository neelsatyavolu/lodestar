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
/** Lookups got better then: a title with " · " details is searched by its name alone, so its older misses are tried again. */
const LOOKUPS_IMPROVED_AT = Date.parse("2026-11-12T09:30:00Z");

export type Lookup = { id: string; title: string; address: string | null; city: string | null } | { id: string; location: LatLng };

/**
 * Itinerary order within a day: by time. Something without a time was added to the day, so it
 * follows the timed plans; a stay without a time is check-in, which ends the day.
 */
export function byItinerary(a: Item, b: Item): number {
  const at = (i: Item) => i.startTime ?? (i.kind === "stay" ? "99:99" : "98:00");
  // At the same time a note follows the stop, so "leave at 5:15" can share its time and still sit after it.
  return `${a.startDate}${at(a)}`.localeCompare(`${b.startDate}${at(b)}`) || Number(a.kind === "note") - Number(b.kind === "note");
}

const located = (i: Item) => i.details.lat !== undefined && i.details.lng !== undefined;

/** The search doing the lookups: Google when there's a key, else OpenStreetMap. */
export type Finder = "google" | "osm";

export function needsLocation(item: Item, now: number, finder: Finder = "osm"): boolean {
  if (item.status === "cancelled" || item.kind === "note") return false;
  const d = item.details;
  // Looked for lately and not found (or a stale pin not refreshed): wait out the week. Google
  // still tries what OpenStreetMap couldn't place; a failure from before this was recorded counts as OpenStreetMap's.
  const failedAt = d.locateFailedAt ?? 0;
  const failedRecently = failedAt >= now - RETRY_FAILED_MS && !(failedAt < LOOKUPS_IMPROVED_AT && searchTitle(item.title) !== item.title);
  if (failedRecently && (finder === "osm" || d.locateFailedWith === "google")) return false;
  if (!located(item)) return true;
  return d.placeId?.startsWith("g:") === true && (d.locatedAt ?? 0) < now - LOCATION_TTL_MS;
}

/** Everything still to pin, flights first (they need no search). */
export function pendingLookups(j: JourneyWithItems, now: number, finder: Finder = "osm"): Lookup[] {
  const out: Lookup[] = [];
  for (const item of j.items) {
    if (!needsLocation(item, now, finder)) continue;
    if (item.kind === "flight") {
      const code = item.details.to;
      const a = code && /^[A-Z]{3}$/.test(code) ? airport(code) : undefined;
      if (a) out.unshift({ id: item.id, location: { lat: a.lat, lng: a.lon } });
      continue;
    }
    // A transfer has no place of its own unless it names one: "Alamo, PHX Rental Car Center", not "Uber".
    const where = item.details.address ?? (item.kind === "transport" && item.place !== j.destination ? item.place : null);
    if (item.kind === "transport" && !where) continue;
    out.push({ id: item.id, title: searchTitle(item.title), address: where, city: item.kind === "transport" ? j.destination : (item.place ?? j.destination) });
  }
  return out;
}

/** What to search for: the name before the details agents tack on ("Alamo rental · Intermediate · $442" → "Alamo rental"). */
export const searchTitle = (title: string) => title.split(/\s+·\s+/)[0].trim() || title;

/** One round of lookups: a locate call does at most this many. */
export const lookupsFor = (j: JourneyWithItems, now: number, finder: Finder = "osm") => pendingLookups(j, now, finder).slice(0, MAX_LOCATE);

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

const firmStay = (i: Item) => i.kind === "stay" && (i.status === "booked" || i.status === "planned") && located(i);

/**
 * A day's route, for drive times: the hotel you woke up in, the located stops in order (a flight
 * stands at the airport it lands at), and the hotel you sleep in that night.
 */
export function dayStops(items: Item[], date: string): Item[] {
  const stops = items
    .filter((i) => i.startDate === date && i.status !== "cancelled" && i.status !== "suggested" && i.kind !== "stay" && i.kind !== "note" && located(i))
    .sort(byItinerary);
  const morning = items.find((s) => firmStay(s) && s.startDate < date && (s.endDate ?? s.startDate) >= date);
  const night = items.find((s) => firmStay(s) && s.startDate <= date && (s.endDate ?? s.startDate) > date);
  if (!stops.length) return [];
  return [...(morning ? [morning] : []), ...stops, ...(night ? [night] : [])];
}

import { airport } from "../airports";
import type { LatLng } from "../places/types";
import type { Item, JourneyWithItems } from "./types";

// Which items still need a pin on the map, and what to search for each.
// Flights pin to their arrival airport from our own airport data (free);
// everything else is looked up by name and address.

/** Google allows keeping coordinates for 30 days; look them up again after that. */
export const LOCATION_TTL_MS = 30 * 86_400_000;
export const MAX_LOCATE = 12;

/** `query` is name plus address (best for Google); `address` alone is what OpenStreetMap finds reliably. */
export type Lookup = { id: string; query: string; address: string | null } | { id: string; location: LatLng };

/**
 * Itinerary order within a day: by time. Something without a time was added to the day, so it
 * follows the timed plans; a stay without a time is check-in, which ends the day.
 */
export function byItinerary(a: Item, b: Item): number {
  const at = (i: Item) => i.startTime ?? (i.kind === "stay" ? "99:99" : "98:00");
  return `${a.startDate}${at(a)}`.localeCompare(`${b.startDate}${at(b)}`);
}

export function needsLocation(item: Item, now: number): boolean {
  if (item.status === "cancelled" || item.kind === "note") return false;
  const d = item.details;
  return d.lat === undefined || d.lng === undefined || (d.placeId?.startsWith("g:") === true && (d.locatedAt ?? 0) < now - LOCATION_TTL_MS);
}

export function lookupsFor(j: JourneyWithItems, now: number): Lookup[] {
  const out: Lookup[] = [];
  for (const item of j.items) {
    if (out.length >= MAX_LOCATE || !needsLocation(item, now)) continue;
    if (item.kind === "flight") {
      const code = item.details.to;
      const a = code && /^[A-Z]{3}$/.test(code) ? airport(code) : undefined;
      if (a) out.push({ id: item.id, location: { lat: a.lat, lng: a.lon } });
      continue;
    }
    const where = item.details.address ?? item.place ?? j.destination;
    if (item.kind === "transport" && !item.details.address) continue;
    out.push({ id: item.id, query: [item.title, where].filter(Boolean).join(", "), address: item.details.address ?? null });
  }
  return out;
}

/** The middle of the trip's pins, to bias searches toward where the trip is. */
export function centerOf(items: Item[]): LatLng | null {
  const pts = items.filter((i) => i.details.lat !== undefined && i.details.lng !== undefined);
  if (!pts.length) return null;
  return { lat: pts.reduce((s, i) => s + i.details.lat!, 0) / pts.length, lng: pts.reduce((s, i) => s + i.details.lng!, 0) / pts.length };
}

/** A day's stops in order, for drive times: located, not cancelled, not ideas, not flights. */
export function dayStops(items: Item[], date: string): Item[] {
  return items
    .filter((i) => i.startDate === date && i.status !== "cancelled" && i.status !== "suggested" && i.kind !== "flight" && i.kind !== "note" && i.details.lat !== undefined)
    .sort(byItinerary);
}

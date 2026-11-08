import { z } from "zod";
import type { Lookup } from "../journeys/locate";
import { resolvePlace, type Search } from "./resolve";
import type { LatLng } from "./types";

// Pinning a trip's items with OpenStreetMap search when there's no Google key.
// It runs in the traveller's browser: Photon is free and allows it, and it
// times out for requests from our servers, which share their addresses with
// everyone else on the host. The page sends back only what it found.

export const LocateResultsSchema = z.object({
  found: z.array(z.object({ id: z.uuid(), placeId: z.string().max(300).regex(/^osm:[\w:.-]+$/).optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).max(50),
  failed: z.array(z.uuid()).max(50),
});
export type LocateResults = z.infer<typeof LocateResultsSchema>;

/** Photon answers bursts with 503s: searches go one at a time, a little apart. */
const SPACING_MS = 150;

/**
 * Looks each item up, nearest the trip's city. An item nothing trustworthy turned up for is
 * `failed`; one whose search errored is in neither list, so it's tried again on a later visit.
 */
export async function locateWithOsm(lookups: Lookup[], search: Search, budgetMs: number): Promise<LocateResults> {
  const spaced: Search = (q, at, limit) => new Promise((r) => setTimeout(r, SPACING_MS)).then(() => search(q, at, limit));
  const anchors = new Map<string, LatLng | null>();
  const anchor = async (city: string | null) => {
    if (!city) return null;
    if (!anchors.has(city)) anchors.set(city, (await spaced(city, null, 1).catch(() => []))[0]?.location ?? null);
    return anchors.get(city) ?? null;
  };

  const out: LocateResults = { found: [], failed: [] };
  const started = Date.now();
  for (const l of lookups) {
    if (Date.now() - started > budgetMs) break;
    if ("location" in l) {
      out.found.push({ id: l.id, ...l.location });
      continue;
    }
    try {
      const hit = await resolvePlace(l, await anchor(l.city), spaced);
      if (hit?.location) out.found.push({ id: l.id, placeId: hit.id, ...hit.location });
      else out.failed.push(l.id);
    } catch {
      // Search refused or timed out: leave it for next time rather than calling it unfindable.
    }
  }
  return out;
}

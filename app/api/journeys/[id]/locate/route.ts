import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getJourney, setItemLocations } from "@/lib/db/journeys";
import { lookupsFor, pendingLookups } from "@/lib/journeys/locate";
import { osmSearch } from "@/lib/places/osm";
import { resolvePlace } from "@/lib/places/resolve";
import type { LatLng } from "@/lib/places/types";
import { google, placesUser } from "@/lib/server/places";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

export const maxDuration = 60;

/** Photon answers bursts with 503s; lookups go one at a time, a little apart. */
const SPACING_MS = 150;
const pause = () => new Promise((r) => setTimeout(r, SPACING_MS));
/** Time for lookups within the 60 s limit, leaving room to save. */
const BUDGET_MS = 35_000;

// POST /api/journeys/:id/locate: pins items that came from email or an import, so they show on the map.
// Does up to MAX_LOCATE per call and says how many are left and how many it settled (pinned or
// marked not found), so the page calls again only while calls make progress.
export function POST(req: Request, ctx: TripCtx) {
  return handle(req, "map pins", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    const db = await getDb();
    const journey = await getJourney(db, who.userId, who.id);
    if (!journey) return fail("That trip doesn't exist.", 404);
    const now = Date.now();
    const lookups = lookupsFor(journey, now);
    if (!lookups.length) return ok({ journey, located: 0, settled: 0, remaining: 0 });
    const gate = await placesUser();
    if (gate instanceof Response) return gate;
    const g = google();

    // Where each city is, looked up once: answers far from it are another place of the same name.
    const anchors = new Map<string, LatLng | null>();
    const anchor = async (city: string | null) => {
      if (!city) return null;
      if (!anchors.has(city)) anchors.set(city, (await osmSearch(city, null, 1).catch(() => []))[0]?.location ?? null);
      return anchors.get(city) ?? null;
    };

    const found: { id: string; placeId?: string; lat: number; lng: number }[] = [];
    const failed: string[] = [];
    const started = Date.now();
    for (const l of lookups) {
      // Stop well inside the function's limit and save what's done; the page asks for the rest.
      if (Date.now() - started > BUDGET_MS) break;
      if ("location" in l) {
        found.push({ id: l.id, ...l.location });
        continue;
      }
      try {
        const near = await anchor(l.city);
        if (g) {
          const hit = await g.locate([l.title, l.address ?? l.city].filter(Boolean).join(", "), near);
          if (hit) found.push({ id: l.id, placeId: `g:${hit.placeId}`, ...hit.location });
          else failed.push(l.id);
        } else {
          const hit = await resolvePlace(l, near, (q, at, limit) => pause().then(() => osmSearch(q, at, limit)));
          if (hit?.location) found.push({ id: l.id, placeId: hit.id, ...hit.location });
          else failed.push(l.id);
        }
      } catch (err) {
        // The search service refused or timed out: try again later rather than marking it unfindable.
        console.error("[locate]", err instanceof Error ? err.message : err);
      }
    }
    await setItemLocations(db, who.userId, found, failed, now);
    const next = await getJourney(db, who.userId, who.id);
    return ok({ journey: next, located: found.length, settled: found.length + failed.length, remaining: next ? pendingLookups(next, now).length : 0 });
  });
}

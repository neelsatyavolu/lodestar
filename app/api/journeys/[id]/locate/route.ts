import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getJourney, setItemLocations } from "@/lib/db/journeys";
import { lookupsFor, pendingLookups } from "@/lib/journeys/locate";
import { LocateResultsSchema } from "@/lib/places/locate-osm";
import { osmSearch } from "@/lib/places/osm";
import type { LatLng } from "@/lib/places/types";
import { google, placesUser } from "@/lib/server/places";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

export const maxDuration = 60;

/** Time for lookups within the 60 s limit, leaving room to save. */
const BUDGET_MS = 35_000;

// POST /api/journeys/:id/locate: pins items that came from email, an import or an agent, so they
// show on the map and get drive times. With a Google key it does up to MAX_LOCATE per call and says
// how many are left and how many it settled (pinned or marked not found), so the page calls again
// only while calls make progress. Without one it answers {browser: true}: OpenStreetMap search
// times out from our servers, so the page looks the items up itself and sends {results}.
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

    if (!g) {
      const body = (await readJson(req, 16_000).catch(() => ({}))) as { results?: unknown };
      if (body?.results === undefined) return ok({ journey, browser: true, located: 0, settled: 0, remaining: pendingLookups(journey, now).length });
      // Only this trip's items that are waiting for a pin.
      const waiting = new Set(pendingLookups(journey, now).map((l) => l.id));
      const results = LocateResultsSchema.parse(body.results);
      const found = results.found.filter((f) => waiting.has(f.id));
      const failed = results.failed.filter((id) => waiting.has(id));
      await setItemLocations(db, who.userId, found, failed, now);
      const next = await getJourney(db, who.userId, who.id);
      return ok({ journey: next, located: found.length, settled: found.length + failed.length, remaining: next ? pendingLookups(next, now).length : 0 });
    }

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
        const hit = await g.locate([l.title, l.address ?? l.city].filter(Boolean).join(", "), await anchor(l.city));
        if (hit) found.push({ id: l.id, placeId: `g:${hit.placeId}`, ...hit.location });
        else failed.push(l.id);
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

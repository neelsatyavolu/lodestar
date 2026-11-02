import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getJourney, setItemLocations } from "@/lib/db/journeys";
import { centerOf, lookupsFor } from "@/lib/journeys/locate";
import { osmSearch } from "@/lib/places/osm";
import { google, placesUser } from "@/lib/server/places";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

export const maxDuration = 60;

// POST /api/journeys/:id/locate: pins items that came from email or an import, so they show on the map.
export function POST(req: Request, ctx: TripCtx) {
  return handle(req, "map pins", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    const db = await getDb();
    const journey = await getJourney(db, who.userId, who.id);
    if (!journey) return fail("That trip doesn't exist.", 404);
    const now = Date.now();
    const lookups = lookupsFor(journey, now);
    if (!lookups.length) return ok({ journey, located: 0 });
    const gate = await placesUser();
    if (gate instanceof Response) return gate;
    const g = google();
    const near = centerOf(journey.items);
    const found = await Promise.all(
      lookups.map(async (l) => {
        if ("location" in l) return { id: l.id, ...l.location };
        try {
          if (g) {
            const hit = await g.locate(l.query, near);
            return hit ? { id: l.id, placeId: `g:${hit.placeId}`, ...hit.location } : null;
          }
          const byAddress = l.address ? await osmSearch(l.address, near, 1) : [];
          const [hit] = byAddress.length ? byAddress : await osmSearch(l.query, near, 1);
          return hit?.location ? { id: l.id, placeId: hit.id, ...hit.location } : null;
        } catch {
          return null;
        }
      }),
    );
    const located = found.filter((f): f is NonNullable<typeof f> => f !== null);
    await setItemLocations(db, who.userId, located, now);
    return ok({ journey: await getJourney(db, who.userId, who.id), located: located.length });
  });
}

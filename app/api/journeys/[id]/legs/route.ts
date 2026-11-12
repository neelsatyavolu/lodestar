import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getJourney } from "@/lib/db/journeys";
import { dayStops } from "@/lib/journeys/locate";
import { IsoDate } from "@/lib/journeys/types";
import { osrmLegs } from "@/lib/places/osrm";
import type { Leg } from "@/lib/places/types";
import { google, placesUser } from "@/lib/server/places";
import { tripAccess, type TripCtx } from "@/lib/server/trip-owner";

// Drives between the same two points barely change; keep them a while to save Routes calls.
const cache = new Map<string, { at: number; leg: Leg | null; legs?: (Leg | null)[] }>();
const CACHE_MS = 6 * 3_600_000;
const MAX_LEGS = 12;

// GET /api/journeys/:id/legs?date=YYYY-MM-DD: drive time and distance between each pair of stops that day.
export function GET(req: Request, ctx: TripCtx) {
  return handle(req, "drive times", async () => {
    const who = await tripAccess(ctx, "view");
    if (who instanceof Response) return who;
    const date = IsoDate.safeParse(new URL(req.url).searchParams.get("date"));
    if (!date.success) return fail("Pick a day.", 400);
    const g = google();
    const journey = await getJourney(await getDb(), who.userId, who.id);
    if (!journey) return fail("That trip doesn't exist.", 404);
    const stops = dayStops(journey.items, date.data);
    if (stops.length < 2) return ok({ legs: [] });
    const gate = await placesUser();
    if (gate instanceof Response) return gate;
    const now = Date.now();
    if (!g) return ok({ legs: await freeLegs(stops.slice(0, MAX_LEGS + 1), now) });
    // Nobody drives to the airport a flight lands at: that leg is the flight.
    const pairs = stops.slice(0, MAX_LEGS + 1).slice(1).map((to, i) => ({ from: stops[i], to })).filter((p) => p.to.kind !== "flight");
    const legs = await Promise.all(
      pairs.map(async ({ from, to }) => {
        const a = { lat: from.details.lat!, lng: from.details.lng! };
        const b = { lat: to.details.lat!, lng: to.details.lng! };
        const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
        const hit = cache.get(key);
        const leg = hit && now - hit.at < CACHE_MS ? hit.leg : await g.drive(a, b).catch(() => null);
        if (!hit || now - hit.at >= CACHE_MS) cache.set(key, { at: now, leg });
        return { from: from.id, to: to.id, leg };
      }),
    );
    if (cache.size > 5000) cache.clear();
    return ok({ legs });
  });
}

/** Without a Google key: OpenStreetMap routing, one request for the whole day. */
async function freeLegs(stops: { id: string; details: { lat?: number; lng?: number } }[], now: number) {
  const points = stops.map((s) => ({ lat: s.details.lat!, lng: s.details.lng! }));
  const key = `osrm:${points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";")}`;
  const hit = cache.get(key);
  const legs = hit && now - hit.at < CACHE_MS ? (hit.legs ?? []) : await osrmLegs(points);
  if (!hit || now - hit.at >= CACHE_MS) cache.set(key, { at: now, leg: null, legs });
  return legs.map((leg, i) => ({ from: stops[i].id, to: stops[i + 1].id, leg }));
}

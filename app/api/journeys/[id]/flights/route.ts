import { fail, handle, ok, rateLimited } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getJourney } from "@/lib/db/journeys";
import { addDays } from "@/lib/format";
import { flightStatus } from "@/lib/flights/aerodatabox";
import type { FlightStatus } from "@/lib/flights/types";
import { flightAirports, flightCode } from "@/lib/journeys/flights";
import { env } from "@/lib/server/env";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

// GET /api/journeys/:id/flights: live status for each flight in the trip,
// keyed by item id. Only flights from yesterday to 30 days out are asked
// about; the rest come back null and show their booked times.

const DAYS_AHEAD = 30;
const MAX_FLIGHTS = 12;

export function GET(req: Request, ctx: TripCtx) {
  return handle(req, "flight status", async () => {
    const limited = rateLimited(req, "flights", 30);
    if (limited) return limited;
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    const key = env().AERODATABOX_KEY;
    const journey = await getJourney(await getDb(), who.userId, who.id);
    if (!journey) return fail("That trip doesn't exist.", 404);
    if (!key) return ok({ live: false, flights: {} });

    const today = new Date().toISOString().slice(0, 10);
    const first = addDays(today, -1);
    const last = addDays(today, DAYS_AHEAD);
    const asks = journey.items
      .filter((i) => i.kind === "flight" && i.status !== "suggested" && i.startDate >= first && i.startDate <= last)
      .slice(0, MAX_FLIGHTS)
      .flatMap((i) => {
        const code = flightCode(i);
        return code ? [{ id: i.id, q: { ...code, date: i.startDate, from: flightAirports(i).from } }] : [];
      });
    const flights: Record<string, FlightStatus | null> = {};
    await Promise.all(asks.map(async ({ id, q }) => (flights[id] = await flightStatus(key, q))));
    return ok({ live: true, flights }, { headers: { "cache-control": "private, max-age=60" } });
  });
}

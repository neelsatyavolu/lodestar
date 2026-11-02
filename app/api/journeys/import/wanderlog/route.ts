import { randomUUID } from "node:crypto";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { countJourneys, MAX_JOURNEYS, upsertItem, upsertJourney } from "@/lib/db/journeys";
import { dedupeKey } from "@/lib/journeys/group";
import { WanderlogSchema } from "@/lib/journeys/input";
import { getWanderlogTrip, listWanderlogTrips, mapWanderlogTrip, MAX_IMPORT, sessionCookie, WanderlogError } from "@/lib/journeys/wanderlog";
import { currentUserId } from "@/lib/server/auth";
import { senderKey } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";

export const maxDuration = 120;

// POST /api/journeys/import/wanderlog {session, keys?}
// Without keys: the traveller's Wanderlog trips, to choose from. With keys: imports those
// (again is safe: each Wanderlog trip maps to one Lodestar trip). The session is used for
// this request only and never stored or logged.
export function POST(req: Request) {
  return handle(req, "Wanderlog import", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    if (!(await allow("wanderlog", senderKey("user", userId)))) return fail("Too many imports. Try again in a few minutes.", 429);
    const body = WanderlogSchema.parse(await readJson(req));
    const cookie = sessionCookie(body.session);
    if (!cookie) return fail("That doesn't look like a Wanderlog session. Copy the connect.sid value.", 400);
    try {
      const trips = await listWanderlogTrips(cookie);
      if (!body.keys) return ok({ trips });
      const owned = new Map(trips.map((t) => [t.key, t]));
      const keys = body.keys.filter((k) => owned.has(k)).slice(0, MAX_IMPORT);
      const db = await getDb();
      if ((await countJourneys(db, userId)) + keys.length > MAX_JOURNEYS) return fail("That would go past the trip limit. Import fewer at once.", 409);
      let imported = 0;
      for (const key of keys) {
        const mapped = mapWanderlogTrip(await getWanderlogTrip(cookie, key));
        const summary = owned.get(key)!;
        await db.transaction(async (tx) => {
          const now = Date.now();
          const journeyId = await upsertJourney(tx, userId, {
            id: randomUUID(),
            title: mapped.title,
            destination: mapped.destination,
            startDate: mapped.startDate ?? summary.startDate,
            endDate: mapped.endDate ?? summary.endDate,
            source: "wanderlog",
            externalKey: `wanderlog:${key}`,
            now,
          });
          for (const item of mapped.items) await upsertItem(tx, userId, { id: randomUUID(), journeyId, source: "wanderlog", dedupeKey: dedupeKey(item), item, now });
        });
        imported++;
      }
      return ok({ imported });
    } catch (err) {
      if (err instanceof WanderlogError) return fail(err.message, err.status === 401 ? 400 : err.status);
      throw err;
    }
  });
}

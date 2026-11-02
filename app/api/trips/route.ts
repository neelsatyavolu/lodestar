import { randomUUID } from "node:crypto";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { countTrips, insertTrip, listTrips } from "@/lib/db/trips";
import { buildQueries, MAX_TRIPS, SaveTripSchema, tripTitle } from "@/lib/trips/input";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";

// A saved shortlist is mostly itineraries; give the body room for six of them.
const MAX_BODY_BYTES = 400_000;

// GET /api/trips: the signed-in account's saved trips, newest first.
export function GET(req: Request) {
  return handle(req, "trip list", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in to see saved trips.", 401);
    return ok({ trips: await listTrips(await getDb(), userId) });
  });
}

// POST /api/trips: save a Plan shortlist. The searches are rebuilt here so the daily check only runs valid ones.
export function POST(req: Request) {
  return handle(req, "trip save", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in to save trips.", 401);
    if (!(await allow("trips", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const input = SaveTripSchema.parse(await readJson(req, MAX_BODY_BYTES));
    const db = await getDb();
    if ((await countTrips(db, userId)) >= MAX_TRIPS) return fail(`You can keep ${MAX_TRIPS} saved trips. Delete one in Trips first.`, 409);
    const queries = buildQueries(input);
    const id = randomUUID();
    const firstDepart = queries.map((q) => q.depart).sort()[0];
    await insertTrip(db, userId, { id, title: tripTitle(queries[0]), prompt: input.snapshot.prompt, queries, snapshot: input.snapshot, firstDepart, price: input.price, createdAt: Date.now() });
    return ok({ id });
  });
}

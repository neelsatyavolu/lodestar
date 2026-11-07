import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { mailNeedingAttention } from "@/lib/db/inbound";
import { listJourneys } from "@/lib/db/journeys";
import { NewJourneySchema } from "@/lib/journeys/input";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { createTrip } from "@/lib/server/plan-ops";

// GET /api/journeys: every trip with its items, items waiting for a trip, and mail waiting to be read.
export function GET(req: Request) {
  return handle(req, "trip list", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in to see your trips.", 401);
    const db = await getDb();
    const [{ journeys, unfiled }, mail] = await Promise.all([listJourneys(db, userId), mailNeedingAttention(db, userId)]);
    return ok({ journeys, unfiled, mail });
  });
}

// POST /api/journeys {destination, startDate?, endDate?, title?, travelers?, tripType?}: start a trip by hand, with a starter checklist.
export function POST(req: Request) {
  return handle(req, "trip create", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in to add trips.", 401);
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const input = NewJourneySchema.parse(await readJson(req));
    return ok({ id: await createTrip(await getDb(), userId, input, "manual") });
  });
}

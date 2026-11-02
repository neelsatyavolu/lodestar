import { randomUUID } from "node:crypto";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { mailNeedingAttention } from "@/lib/db/inbound";
import { countJourneys, listJourneys, MAX_JOURNEYS, upsertJourney } from "@/lib/db/journeys";
import { journeyTitle } from "@/lib/journeys/group";
import { NewJourneySchema } from "@/lib/journeys/input";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";

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

// POST /api/journeys {destination, startDate?, endDate?, title?}: start a trip by hand.
export function POST(req: Request) {
  return handle(req, "trip create", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in to add trips.", 401);
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const input = NewJourneySchema.parse(await readJson(req));
    const db = await getDb();
    if ((await countJourneys(db, userId)) >= MAX_JOURNEYS) return fail(`You can keep ${MAX_JOURNEYS} trips. Delete an old one first.`, 409);
    const id = await upsertJourney(db, userId, {
      id: randomUUID(),
      title: input.title ?? (input.startDate ? journeyTitle(input.destination, input.startDate) : input.destination),
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate ?? input.startDate,
      source: "manual",
      now: Date.now(),
    });
    return ok({ id });
  });
}

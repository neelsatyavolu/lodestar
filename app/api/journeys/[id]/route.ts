import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteJourney, getJourney, updateJourney } from "@/lib/db/journeys";
import { JourneyPatchSchema } from "@/lib/journeys/input";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

const MISSING = "That trip doesn't exist.";

// GET /api/journeys/:id: one trip with its items.
export function GET(req: Request, ctx: TripCtx) {
  return handle(req, "trip load", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    const journey = await getJourney(await getDb(), who.userId, who.id);
    return journey ? ok({ journey }) : fail(MISSING, 404);
  });
}

// PATCH /api/journeys/:id {title?, destination?, startDate?, endDate?}
export function PATCH(req: Request, ctx: TripCtx) {
  return handle(req, "trip update", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const db = await getDb();
    if (!(await updateJourney(db, who.userId, who.id, JourneyPatchSchema.parse(await readJson(req)), Date.now()))) return fail(MISSING, 404);
    return ok({ journey: await getJourney(db, who.userId, who.id) });
  });
}

// DELETE /api/journeys/:id: the trip and everything in it.
export function DELETE(req: Request, ctx: TripCtx) {
  return handle(req, "trip delete", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    return (await deleteJourney(await getDb(), who.userId, who.id)) ? ok({}) : fail(MISSING, 404);
  });
}

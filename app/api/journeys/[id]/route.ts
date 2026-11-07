import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteJourney, getJourney } from "@/lib/db/journeys";
import { JourneyPatchSchema } from "@/lib/journeys/input";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { updateTrip } from "@/lib/server/plan-ops";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

const MISSING = "That trip doesn't exist.";

// GET /api/journeys/:id: one trip with its items, checklist, notes and budget lines.
export function GET(req: Request, ctx: TripCtx) {
  return handle(req, "trip load", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    const journey = await getJourney(await getDb(), who.userId, who.id);
    return journey ? ok({ journey }) : fail(MISSING, 404);
  });
}

// PATCH /api/journeys/:id {title?, destination?, startDate?, endDate?, travelers?, tripType?}
export function PATCH(req: Request, ctx: TripCtx) {
  return handle(req, "trip update", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    return ok({ journey: await updateTrip(await getDb(), who.userId, who.id, JourneyPatchSchema.parse(await readJson(req))) });
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

import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteJourney, getJourney } from "@/lib/db/journeys";
import { sharedWith } from "@/lib/db/members";
import { JourneyPatchSchema } from "@/lib/journeys/input";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { updateTrip } from "@/lib/server/plan-ops";
import { tripAccess, type TripCtx } from "@/lib/server/trip-owner";
import { viewerTrip } from "@/lib/journeys/share";

const MISSING = "That trip doesn't exist.";

// GET /api/journeys/:id: one trip with its items, checklist, notes and budget lines.
export function GET(req: Request, ctx: TripCtx) {
  return handle(req, "trip load", async () => {
    const who = await tripAccess(ctx, "view");
    if (who instanceof Response) return who;
    const db = await getDb();
    const journey = await getJourney(db, who.userId, who.id);
    if (!journey) return fail(MISSING, 404);
    if (who.role === "owner") return ok({ journey });
    // Someone it was shared with: say whose it is; a viewer gets it without confirmations, prices, the budget or the share link.
    const owner = (await sharedWith(db, who.actorId)).find((s) => s.journeyId === who.id)?.owner ?? "";
    const trip = who.role === "viewer" ? viewerTrip(journey) : journey;
    return ok({ journey: { ...trip, access: { role: who.role, owner } } });
  });
}

// PATCH /api/journeys/:id {title?, destination?, startDate?, endDate?, travelers?, tripType?}
export function PATCH(req: Request, ctx: TripCtx) {
  return handle(req, "trip update", async () => {
    const who = await tripAccess(ctx, "edit");
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    return ok({ journey: await updateTrip(await getDb(), who.userId, who.id, JourneyPatchSchema.parse(await readJson(req))) });
  });
}

// DELETE /api/journeys/:id: the trip and everything in it.
export function DELETE(req: Request, ctx: TripCtx) {
  return handle(req, "trip delete", async () => {
    const who = await tripAccess(ctx, "own");
    if (who instanceof Response) return who;
    return (await deleteJourney(await getDb(), who.userId, who.id)) ? ok({}) : fail(MISSING, 404);
  });
}

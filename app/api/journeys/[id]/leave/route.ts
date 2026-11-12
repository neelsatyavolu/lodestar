import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { leaveTrip } from "@/lib/db/members";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

// POST /api/journeys/:id/leave: someone a trip was shared with stops seeing it.
export function POST(req: Request, ctx: TripCtx) {
  return handle(req, "leave trip", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    return (await leaveTrip(await getDb(), who.userId, who.id)) ? ok({}) : fail("You're not on that trip.", 404);
  });
}

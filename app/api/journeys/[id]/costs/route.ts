import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { NewCostSchema } from "@/lib/journeys/input";
import { addTripCost } from "@/lib/server/plan-ops";
import { plannerWrite, type TripCtx } from "@/lib/server/trip-owner";

// POST /api/journeys/:id/costs {label, amount, currency?, category?, paid?}: a budget line that isn't a booking.
export function POST(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "budget add", async (who) => ok({ cost: await addTripCost(await getDb(), who.userId, who.id, NewCostSchema.parse(await readJson(req, 4_000)), "manual") }));
}

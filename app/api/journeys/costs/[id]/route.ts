import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { CostPatchSchema } from "@/lib/journeys/input";
import { patchCost, removeCost } from "@/lib/server/plan-ops";
import { plannerWrite, type TripCtx } from "@/lib/server/trip-owner";

// PATCH /api/journeys/costs/:id {label?, amount?, currency?, category?, paid?}
export function PATCH(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "budget update", async (who) => ok({ cost: await patchCost(await getDb(), who.userId, who.id, CostPatchSchema.parse(await readJson(req, 4_000))) }));
}

// DELETE /api/journeys/costs/:id
export function DELETE(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "budget delete", async (who) => {
    await removeCost(await getDb(), who.userId, who.id);
    return ok({});
  });
}

import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { TaskPatchSchema } from "@/lib/journeys/input";
import { patchTask, removeTask } from "@/lib/server/plan-ops";
import { plannerWrite, type TripCtx } from "@/lib/server/trip-owner";

// PATCH /api/journeys/tasks/:id {title?, done?, due?, section?}: tick off or edit a checklist item.
export function PATCH(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "checklist update", async (who) => ok({ task: await patchTask(await getDb(), who.userId, who.id, TaskPatchSchema.parse(await readJson(req, 4_000))) }));
}

// DELETE /api/journeys/tasks/:id
export function DELETE(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "checklist delete", async (who) => {
    await removeTask(await getDb(), who.userId, who.id);
    return ok({});
  });
}

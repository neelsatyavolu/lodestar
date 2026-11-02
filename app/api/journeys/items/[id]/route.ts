import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteItem, updateItem, widenJourney } from "@/lib/db/journeys";
import { ItemPatchSchema } from "@/lib/journeys/input";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

const MISSING = "That item doesn't exist.";

// PATCH /api/journeys/items/:id: keep a suggestion, file it in a trip, edit it, or mark it cancelled.
export function PATCH(req: Request, ctx: TripCtx) {
  return handle(req, "item update", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const patch = ItemPatchSchema.parse(await readJson(req, 16_000));
    const db = await getDb();
    const item = await db.transaction(async (tx) => {
      const updated = await updateItem(tx, who.userId, who.id, patch, Date.now());
      if (updated?.journeyId && updated.status !== "cancelled") await widenJourney(tx, who.userId, updated.journeyId, updated.startDate, updated.endDate ?? updated.startDate);
      return updated;
    });
    return item ? ok({ item }) : fail(MISSING, 404);
  });
}

// DELETE /api/journeys/items/:id
export function DELETE(req: Request, ctx: TripCtx) {
  return handle(req, "item delete", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    return (await deleteItem(await getDb(), who.userId, who.id)) ? ok({}) : fail(MISSING, 404);
  });
}

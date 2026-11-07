import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { NotePatchSchema } from "@/lib/journeys/input";
import { patchNote, removeNote } from "@/lib/server/plan-ops";
import { plannerWrite, type TripCtx } from "@/lib/server/trip-owner";

// PATCH /api/journeys/notes/:id {title?, body?}
export function PATCH(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "note update", async (who) => ok({ note: await patchNote(await getDb(), who.userId, who.id, NotePatchSchema.parse(await readJson(req, 12_000))) }));
}

// DELETE /api/journeys/notes/:id
export function DELETE(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "note delete", async (who) => {
    await removeNote(await getDb(), who.userId, who.id);
    return ok({});
  });
}

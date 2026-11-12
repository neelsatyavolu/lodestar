import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { NotePatchSchema } from "@/lib/journeys/input";
import { patchNote, removeNote } from "@/lib/server/plan-ops";
import { childWrite, type TripCtx } from "@/lib/server/trip-owner";

// PATCH /api/journeys/notes/:id {title?, body?}
export function PATCH(req: Request, ctx: TripCtx) {
  return childWrite(req, ctx, "note", "note update", async (who) => ok({ note: await patchNote(await getDb(), who.userId, who.id, NotePatchSchema.parse(await readJson(req, 12_000))) }));
}

// DELETE /api/journeys/notes/:id
export function DELETE(req: Request, ctx: TripCtx) {
  return childWrite(req, ctx, "note", "note delete", async (who) => {
    await removeNote(await getDb(), who.userId, who.id);
    return ok({});
  });
}

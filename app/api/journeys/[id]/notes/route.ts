import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { NoteSchema } from "@/lib/journeys/input";
import { writeNote } from "@/lib/server/plan-ops";
import { plannerWrite, type TripCtx } from "@/lib/server/trip-owner";

// POST /api/journeys/:id/notes {title, body}: add a note, or replace the one with that title.
export function POST(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "note save", async (who) => ok({ note: await writeNote(await getDb(), who.userId, who.id, NoteSchema.parse(await readJson(req, 12_000)), "manual") }));
}

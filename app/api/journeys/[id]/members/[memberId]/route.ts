import { z } from "zod";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { removeMember, setMemberEdit } from "@/lib/db/members";
import { tripAccess, type TripCtx } from "@/lib/server/trip-owner";

type Ctx = { params: Promise<{ id: string; memberId: string }> };
const Id = z.uuid();
const PatchSchema = z.object({ canEdit: z.boolean() });

const memberId = async (ctx: Ctx) => Id.safeParse((await ctx.params).memberId);
const asTrip = (ctx: Ctx): TripCtx => ({ params: ctx.params.then((p) => ({ id: p.id })) });

// PATCH /api/journeys/:id/members/:memberId {canEdit}: switch someone between editing and viewing (owner only).
export function PATCH(req: Request, ctx: Ctx) {
  return handle(req, "sharing", async () => {
    const who = await tripAccess(asTrip(ctx), "own");
    if (who instanceof Response) return who;
    const id = await memberId(ctx);
    if (!id.success) return fail("That person isn't on this trip.", 404);
    const { canEdit } = PatchSchema.parse(await readJson(req, 500));
    return (await setMemberEdit(await getDb(), who.userId, who.id, id.data, canEdit)) ? ok({}) : fail("That person isn't on this trip.", 404);
  });
}

// DELETE /api/journeys/:id/members/:memberId: the owner removes someone, or a member leaves.
export function DELETE(req: Request, ctx: Ctx) {
  return handle(req, "sharing", async () => {
    const who = await tripAccess(asTrip(ctx), "view");
    if (who instanceof Response) return who;
    const id = await memberId(ctx);
    if (!id.success) return fail("That person isn't on this trip.", 404);
    return (await removeMember(await getDb(), who.actorId, who.id, id.data)) ? ok({}) : fail("That person isn't on this trip.", 404);
  });
}

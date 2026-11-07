import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { revokeGrant } from "@/lib/db/agent-auth";
import { z } from "zod";
import { currentUserId } from "@/lib/server/auth";
import type { TripCtx } from "@/lib/server/trip-owner";

// DELETE /api/agents/:id: disconnect an app or delete a personal token. Its tokens stop working at once.
export function DELETE(req: Request, ctx: TripCtx) {
  return handle(req, "agent revoke", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) return fail("That connection doesn't exist.", 404);
    return (await revokeGrant(await getDb(), userId, id.data)) ? ok({}) : fail("That connection doesn't exist.", 404);
  });
}

import { z } from "zod";
import { fail, handle } from "../api";
import { currentUserId, ipKey } from "./auth";
import { allow } from "./limits";

export type TripCtx = { params: Promise<{ id: string }> };
const Id = z.uuid();

/**
 * Runs a planner change for the signed-in traveller on the id in the URL (a
 * trip, task, note or cost): refuses cross-site requests, checks sign-in and
 * the rate limit, and maps refusals to clean JSON.
 */
export function plannerWrite(req: Request, ctx: TripCtx, what: string, run: (who: { userId: string; id: string }) => Promise<Response>): Promise<Response> {
  return handle(req, what, async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    return run(who);
  });
}

/** The signed-in traveller and the trip id from the URL, or the response to send instead. */
export async function tripOwner(ctx: TripCtx): Promise<{ userId: string; id: string } | Response> {
  const userId = await currentUserId();
  if (!userId) return fail("Sign in first.", 401);
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return fail("That trip doesn't exist.", 404);
  return { userId, id: id.data };
}

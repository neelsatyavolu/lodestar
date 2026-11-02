import { z } from "zod";
import { fail } from "../api";
import { currentUserId } from "./auth";

export type TripCtx = { params: Promise<{ id: string }> };
const Id = z.uuid();

/** The signed-in traveller and the trip id from the URL, or the response to send instead. */
export async function tripOwner(ctx: TripCtx): Promise<{ userId: string; id: string } | Response> {
  const userId = await currentUserId();
  if (!userId) return fail("Sign in first.", 401);
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return fail("That trip doesn't exist.", 404);
  return { userId, id: id.data };
}

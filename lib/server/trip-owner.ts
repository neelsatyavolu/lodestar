import { z } from "zod";
import { fail, handle } from "../api";
import { currentUserId, ipKey } from "./auth";
import { getDb } from "../db/client";
import { accessFor, childOf, type Child, type Role } from "../db/members";
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

// ---------- Shared trips ----------
// A trip's rows stay under its owner's account. These resolve the signed-in
// person's role on a trip (or on the trip behind an item, task, note or cost)
// and hand back the OWNER's id as `userId`, so the existing owner-scoped
// queries run unchanged for an editor. `actorId` is who is actually signed in.

export type Need = "view" | "edit" | "own";
export type Access = { userId: string; actorId: string; id: string; role: Role };

const NOT_FOUND = "That trip doesn't exist.";
const may = (role: Role, need: Need) => need === "view" || (need === "edit" ? role !== "viewer" : role === "owner");
const refuse = (role: Role) => fail(role === "viewer" ? "You can view this trip but not change it." : "Only the trip's owner can do that.", 403);

/** The signed-in person's access to the trip in the URL, or the response to send instead. */
export async function tripAccess(ctx: TripCtx, need: Need): Promise<Access | Response> {
  const who = await tripOwner(ctx);
  if (who instanceof Response) return who;
  const access = await accessFor(await getDb(), who.userId, who.id);
  // No access looks the same as no trip: a stranger learns nothing about which ids exist.
  if (!access) return fail(NOT_FOUND, 404);
  if (!may(access.role, need)) return refuse(access.role);
  return { userId: access.ownerId, actorId: who.userId, id: who.id, role: access.role };
}

/** The same for an item, task, note or cost in the URL: access comes from the trip it's in. */
export async function childAccess(ctx: TripCtx, kind: Child, need: Need): Promise<Access | Response> {
  const who = await tripOwner(ctx);
  if (who instanceof Response) return who;
  const db = await getDb();
  const child = await childOf(db, kind, who.id);
  const missing = fail(`That ${kind === "task" ? "checklist item" : kind} doesn't exist.`, 404);
  if (!child) return missing;
  if (child.ownerId === who.userId) return { userId: who.userId, actorId: who.userId, id: who.id, role: "owner" };
  // Unfiled items belong to their owner alone.
  const access = child.journeyId ? await accessFor(db, who.userId, child.journeyId) : null;
  if (!access) return missing;
  if (!may(access.role, need)) return refuse(access.role);
  return { userId: child.ownerId, actorId: who.userId, id: who.id, role: access.role };
}

/** A rate-limited change to a trip the signed-in person may edit. */
export function tripWrite(req: Request, ctx: TripCtx, what: string, run: (who: Access) => Promise<Response>): Promise<Response> {
  return handle(req, what, async () => {
    const who = await tripAccess(ctx, "edit");
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    return run(who);
  });
}

/** A rate-limited change to an item, task, note or cost on a trip the signed-in person may edit. */
export function childWrite(req: Request, ctx: TripCtx, kind: Child, what: string, run: (who: Access) => Promise<Response>): Promise<Response> {
  return handle(req, what, async () => {
    const who = await childAccess(ctx, kind, "edit");
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    return run(who);
  });
}

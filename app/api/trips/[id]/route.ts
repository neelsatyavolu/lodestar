import { z } from "zod";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteTrip, getTripSnapshot, updateTripAlerts } from "@/lib/db/trips";
import { UpdateAlertsSchema } from "@/lib/trips/input";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";

type Ctx = { params: Promise<{ id: string }> };
const Id = z.uuid();

async function owner(ctx: Ctx): Promise<{ userId: string; id: string } | Response> {
  const userId = await currentUserId();
  if (!userId) return fail("Sign in first.", 401);
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return fail("That trip doesn't exist.", 404);
  return { userId, id: id.data };
}

// GET /api/trips/:id: the saved shortlist, to show again.
export function GET(req: Request, ctx: Ctx) {
  return handle(req, "trip load", async () => {
    const who = await owner(ctx);
    if (who instanceof Response) return who;
    const snapshot = await getTripSnapshot(await getDb(), who.userId, who.id);
    return snapshot ? ok({ snapshot }) : fail("That trip doesn't exist.", 404);
  });
}

// PATCH /api/trips/:id {alertDrop?, targetPrice?, remindOn?}: change the trip's alerts.
export function PATCH(req: Request, ctx: Ctx) {
  return handle(req, "alert update", async () => {
    const who = await owner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("trips", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const trip = await updateTripAlerts(await getDb(), who.userId, who.id, UpdateAlertsSchema.parse(await readJson(req)));
    return trip ? ok({ trip }) : fail("That trip doesn't exist.", 404);
  });
}

// DELETE /api/trips/:id
export function DELETE(req: Request, ctx: Ctx) {
  return handle(req, "trip delete", async () => {
    const who = await owner(ctx);
    if (who instanceof Response) return who;
    return (await deleteTrip(await getDb(), who.userId, who.id)) ? ok({}) : fail("That trip doesn't exist.", 404);
  });
}

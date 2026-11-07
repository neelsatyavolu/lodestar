import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { NewItemSchema } from "@/lib/journeys/input";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { addItems } from "@/lib/server/plan-ops";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

// POST /api/journeys/:id/items {kind, title, startDate, ...}: add a flight, stay, reservation or plan by hand.
export function POST(req: Request, ctx: TripCtx) {
  return handle(req, "item add", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const item = NewItemSchema.parse(await readJson(req, 16_000));
    const [id] = await addItems(await getDb(), who.userId, who.id, [item], "manual");
    return ok({ id });
  });
}

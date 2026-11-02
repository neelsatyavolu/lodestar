import { randomUUID } from "node:crypto";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { countItems, getJourney, journeysForKeys, MAX_ITEMS, upsertItem, widenJourney } from "@/lib/db/journeys";
import { dedupeKey } from "@/lib/journeys/group";
import { NewItemSchema } from "@/lib/journeys/input";
import { ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

// POST /api/journeys/:id/items {kind, title, startDate, ...}: add a flight, stay, reservation or plan by hand.
export function POST(req: Request, ctx: TripCtx) {
  return handle(req, "item add", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const item = NewItemSchema.parse(await readJson(req, 16_000));
    const db = await getDb();
    if (!(await getJourney(db, who.userId, who.id))) return fail("That trip doesn't exist.", 404);
    if ((await countItems(db, who.userId)) >= MAX_ITEMS) return fail("This account has too many items. Delete some old trips first.", 409);
    const id = await db.transaction(async (tx) => {
      // Typed by hand, it may only merge with the same booking in this trip, never pull one out of another trip.
      let key = dedupeKey(item);
      if (key) {
        const owner = (await journeysForKeys(tx, who.userId, [key])).get(key);
        if (owner !== undefined && owner !== who.id) key = null;
      }
      const stored = await upsertItem(tx, who.userId, { id: randomUUID(), journeyId: who.id, source: "manual", dedupeKey: key, item, now: Date.now() });
      await widenJourney(tx, who.userId, who.id, item.startDate, item.endDate ?? item.startDate);
      return stored;
    });
    return ok({ id });
  });
}

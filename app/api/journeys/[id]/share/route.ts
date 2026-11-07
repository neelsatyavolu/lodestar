import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { ShareSchema } from "@/lib/journeys/input";
import { env } from "@/lib/server/env";
import { setSharing } from "@/lib/server/plan-ops";
import { plannerWrite, type TripCtx } from "@/lib/server/trip-owner";

// POST /api/journeys/:id/share {on}: turn the trip's read-only link on or off. Returns {url} or {url: null}.
export function POST(req: Request, ctx: TripCtx) {
  return plannerWrite(req, ctx, "share", async (who) => {
    const { on } = ShareSchema.parse(await readJson(req, 1_000));
    const token = await setSharing(await getDb(), who.userId, who.id, on);
    return ok({ url: token ? `${env().APP_URL}/t/${token}` : null });
  });
}

import { ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { NewTaskSchema } from "@/lib/journeys/input";
import { addTripTasks } from "@/lib/server/plan-ops";
import { tripWrite, type TripCtx } from "@/lib/server/trip-owner";

// POST /api/journeys/:id/tasks {title, due?, section?}: add to the trip's checklist.
export function POST(req: Request, ctx: TripCtx) {
  return tripWrite(req, ctx, "checklist add", async (who) => {
    const task = NewTaskSchema.parse(await readJson(req, 4_000));
    const [added] = await addTripTasks(await getDb(), who.userId, who.id, [task], "manual");
    return ok({ task: added });
  });
}

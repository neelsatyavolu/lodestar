import { fail, handle, ok, readJson } from "@/lib/api";
import { ModelError, complete } from "@/lib/ai/complete";
import { resolveModel } from "@/lib/ai/models";
import type { Provider } from "@/lib/ai/providers";
import { getDb, type Db } from "@/lib/db/client";
import { getJourney } from "@/lib/db/journeys";
import { deleteAiCosts } from "@/lib/db/plan";
import { getPreferences } from "@/lib/db/preferences";
import { describeTastes, tripDays } from "@/lib/journeys/ai";
import { PART_PROMPTS, parseBudget, parseChecklist, parseItinerary, parseNotes, parseToBook, type PlanContext } from "@/lib/journeys/generate";
import { GenerateSchema, type PlanPart } from "@/lib/journeys/input";
import { aiTokens, senderKey } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";
import { addItems, addTripCost, addTripTasks, patchItem, writeNote } from "@/lib/server/plan-ops";
import { tripAccess, type TripCtx } from "@/lib/server/trip-owner";

// One model call, which can take a while on a long trip.
export const maxDuration = 300;

const NOTHING = "The AI didn't come back with anything usable. Try again.";

/** Applies the model's answer for one part. Returns how many things changed, or a message when nothing could be used. */
async function apply(db: Db, userId: string, part: PlanPart, text: string, c: PlanContext): Promise<number | string> {
  const id = c.trip.id;
  switch (part) {
    case "itinerary": {
      const items = parseItinerary(text, c);
      return items.length ? (await addItems(db, userId, id, items, "ai")).length : NOTHING;
    }
    case "to_book": {
      const plan = parseToBook(text, c);
      for (const f of plan.flags) await patchItem(db, userId, f.id, { facts: { reserve: true, ...(f.bookBy ? { bookBy: f.bookBy } : {}) } });
      if (plan.add.length) await addItems(db, userId, id, plan.add, "ai");
      return plan.flags.length + plan.add.length;
    }
    case "checklist": {
      const tasks = parseChecklist(text, c);
      return tasks.length ? (await addTripTasks(db, userId, id, tasks, "ai")).length : 0;
    }
    case "notes": {
      const notes = parseNotes(text);
      for (const n of notes) await writeNote(db, userId, id, n, "ai");
      return notes.length || NOTHING;
    }
    case "budget": {
      const plan = parseBudget(text, c);
      if (!plan.estimates.length && !plan.costs.length) return NOTHING;
      for (const e of plan.estimates) await patchItem(db, userId, e.id, { facts: { estimate: e.amount } });
      // A fresh estimate replaces the AI's earlier lines; ones the traveller added or marked paid stay.
      await deleteAiCosts(db, userId, id);
      for (const x of plan.costs) await addTripCost(db, userId, id, { ...x, currency: "USD", paid: false }, "ai");
      return plan.estimates.length + plan.costs.length;
    }
  }
}

// POST /api/journeys/:id/generate {provider, part, wishes?}: the traveller's own ChatGPT or Grok drafts one part of the plan.
export function POST(req: Request, ctx: TripCtx) {
  return handle(req, "plan draft", async () => {
    const who = await tripAccess(ctx, "edit");
    if (who instanceof Response) return who;
    const body = GenerateSchema.parse(await readJson(req, 4_000));
    const provider = body.provider as Provider;
    if (!(await allow("journeysAi", senderKey("user", who.actorId)))) return fail("That's a lot of AI calls. Try again in a few minutes.", 429);
    const db = await getDb();
    const trip = await getJourney(db, who.userId, who.id);
    if (!trip) return fail("That trip doesn't exist.", 404);
    if (!trip.destination) return fail("Give the trip a destination first.", 400);
    if (!tripDays(trip).length) return fail("Give the trip dates first.", 400);
    const tokens = await aiTokens(provider);
    if (tokens instanceof Response) return tokens;

    const c: PlanContext = { trip, tastes: describeTastes(await getPreferences(db, who.actorId)), wishes: body.wishes ?? null, today: new Date().toISOString().slice(0, 10) };
    const prompt = PART_PROMPTS[body.part];
    let text: string;
    try {
      const model = await resolveModel(provider, undefined, prompt.speed);
      text = await complete({ provider, tokens, model, system: prompt.system, user: prompt.user(c), effort: "medium", signal: req.signal });
    } catch (err) {
      if (err instanceof ModelError) return fail(err.message, 502);
      throw err;
    }
    const added = await apply(db, who.userId, body.part, text, c);
    if (typeof added === "string") return fail(added, 422);
    return ok({ journey: await getJourney(db, who.userId, who.id), added });
  });
}

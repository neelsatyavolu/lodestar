import { randomUUID } from "node:crypto";
import { fail, handle, ok, readJson } from "@/lib/api";
import { ModelError, complete } from "@/lib/ai/complete";
import { FaresError, searchStays } from "@/lib/fares";
import { resolveModel } from "@/lib/ai/models";
import type { Provider } from "@/lib/ai/providers";
import { getDb } from "@/lib/db/client";
import { deleteSuggestions, getJourney, upsertItem } from "@/lib/db/journeys";
import { getPreferences } from "@/lib/db/preferences";
import { DINING_SYSTEM_PROMPT, HOTEL_SYSTEM_PROMPT, describeTastes, diningUserPrompt, hotelUserPrompt, mapsLink, parseDining, parseHotelPicks, tripDays } from "@/lib/journeys/ai";
import { SuggestSchema } from "@/lib/journeys/input";
import { DraftItemSchema, type DraftItem, type JourneyWithItems } from "@/lib/journeys/types";
import { MAX_NIGHTS, StaysSearchSchema } from "@/lib/stays/types";
import { aiTokens, senderKey } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";
import { tripOwner, type TripCtx } from "@/lib/server/trip-owner";

// A live hotel search plus one model call; allow a couple of minutes.
export const maxDuration = 300;
const HOTEL_CANDIDATES = 15;

const nights = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

async function hotelSuggestions(j: JourneyWithItems, tastes: string, ai: { provider: Provider; tokens: Exclude<Awaited<ReturnType<typeof aiTokens>>, Response>; model: string }, signal: AbortSignal): Promise<DraftItem[] | string> {
  if (!j.destination || !j.startDate || !j.endDate || nights(j.startDate, j.endDate) < 1) return "Give the trip a destination and dates first.";
  if (nights(j.startDate, j.endDate) > MAX_NIGHTS) return `Hotel picks work for stays up to ${MAX_NIGHTS} nights.`;
  const query = StaysSearchSchema.safeParse({ city: j.destination, checkin: j.startDate, checkout: j.endDate, adults: 2 });
  if (!query.success) return query.error.issues[0]?.message ?? "Check the trip's destination and dates.";
  const { hotels: all, url } = await searchStays(query.data, signal);
  const hotels = all.slice(0, HOTEL_CANDIDATES);
  if (!hotels.length) return "The hotel search found nothing for these dates.";
  const text = await complete({ provider: ai.provider, tokens: ai.tokens, model: ai.model, system: HOTEL_SYSTEM_PROMPT, user: hotelUserPrompt(j, tastes, hotels), effort: "medium", signal });
  return parseHotelPicks(text, hotels).map(({ hotel, why }) =>
    DraftItemSchema.parse({
      kind: "stay",
      status: "suggested",
      title: hotel.name,
      startDate: j.startDate,
      endDate: j.endDate,
      place: j.destination,
      // The live search's price, never the model's.
      details: { price: Math.round(hotel.price), currency: "USD", why: why || undefined, rating: hotel.rating ?? undefined, url: url ?? mapsLink(`${hotel.name} ${j.destination}`) },
    }),
  );
}

// POST /api/journeys/:id/suggest {provider, kind: "dining" | "hotels"}: replace this trip's suggestions of that kind with fresh ones.
export function POST(req: Request, ctx: TripCtx) {
  return handle(req, "suggestions", async () => {
    const who = await tripOwner(ctx);
    if (who instanceof Response) return who;
    const body = SuggestSchema.parse(await readJson(req));
    const provider = body.provider as Provider;
    if (!(await allow("journeysAi", senderKey("user", who.userId)))) return fail("That's a lot of AI calls. Try again in a few minutes.", 429);
    const db = await getDb();
    const journey = await getJourney(db, who.userId, who.id);
    if (!journey) return fail("That trip doesn't exist.", 404);
    if (!tripDays(journey).length) return fail("Give the trip dates first.", 400);
    const tokens = await aiTokens(provider);
    if (tokens instanceof Response) return tokens;
    const tastes = describeTastes(await getPreferences(db, who.userId));
    const model = await resolveModel(provider, undefined, body.kind === "dining" ? "main" : "fast");

    let items: DraftItem[] | string;
    try {
      items =
        body.kind === "dining"
          ? parseDining(await complete({ provider, tokens, model, system: DINING_SYSTEM_PROMPT, user: diningUserPrompt(journey, tastes), effort: "medium", signal: req.signal }), journey)
          : await hotelSuggestions(journey, tastes, { provider, tokens, model }, req.signal);
    } catch (err) {
      if (err instanceof ModelError) return fail(err.message, 502);
      if (err instanceof FaresError) throw err;
      if (err instanceof SyntaxError || (err instanceof Error && /did not return JSON/.test(err.message))) return fail("The AI answer was not in the expected shape. Try again.", 502);
      throw err;
    }
    if (typeof items === "string") return fail(items, 400);
    if (!items.length) return fail("The AI didn't come back with anything usable. Try again.", 502);

    const kind = body.kind === "dining" ? "dining" : "stay";
    await db.transaction(async (tx) => {
      await deleteSuggestions(tx, who.userId, who.id, kind);
      for (const item of items) await upsertItem(tx, who.userId, { id: randomUUID(), journeyId: who.id, source: "ai", dedupeKey: null, item, now: Date.now() });
    });
    return ok({ journey: await getJourney(db, who.userId, who.id) });
  });
}

import { z } from "zod";
import { fail, rateLimited, readJson } from "@/lib/api";
import {
  CANVAS_SYSTEM_PROMPT,
  buildCandidates,
  describeDefaults,
  parseCanvas,
  parsePlan,
  planSystemPrompt,
  toQuery,
  type SearchOutcome,
} from "@/lib/ai/canvas";
import { ModelError, complete } from "@/lib/ai/complete";
import { resolveModel } from "@/lib/ai/models";
import { isProvider, type Provider } from "@/lib/ai/providers";
import { aiOwner, getActiveSession } from "@/lib/ai/session";
import { PreferencesSchema } from "@/lib/preferences";
import { runSearch } from "@/lib/search";
import { AirlineCode, ALLIANCES, SearchQuerySchema } from "@/lib/types";

// Plans, runs up to five live searches, then picks: allow a few minutes.
export const maxDuration = 300;

const Body = z.object({
  provider: z.string().refine(isProvider, "Unknown provider."),
  model: z.string().max(60).optional(),
  prompt: z.string().trim().min(3, "Tell Lodestar where you want to go.").max(1200),
  context: z.record(z.string(), z.unknown()).nullable().optional(),
  // Earlier turns of this conversation, oldest first, so a short reply has context.
  history: z.array(z.object({ prompt: z.string().max(1200), reply: z.string().max(600) })).max(4).default([]),
  // Saved trip defaults, so the planner can fill gaps instead of asking.
  defaults: PreferencesSchema.pick({ homeAirports: true, cabin: true, stops: true, adults: true, bags: true }).nullable().optional(),
  // The traveller's saved or current filters, applied to every planned search.
  filters: z
    .object({
      alliances: z.array(z.enum(ALLIANCES)).max(3).default([]),
      avoidAirlines: z.array(AirlineCode).max(20).default([]),
      preferAirlines: z.array(AirlineCode).max(10).default([]),
      noBasicEconomy: z.boolean().default(false),
      avoidRedEyes: z.boolean().default(false),
      avoidSelfTransfer: z.boolean().default(true),
    })
    .partial()
    .nullable()
    .optional(),
});

const SEARCH_CONCURRENCY = 2;

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function userPrompt(body: z.infer<typeof Body>): string {
  const parts = [`Traveller: ${body.prompt}`];
  if (body.defaults) parts.push(`Their saved defaults: ${describeDefaults(body.defaults)}`);
  if (body.context) parts.push(`Their current search form (use it as defaults): ${JSON.stringify(body.context)}`);
  if (body.filters && Object.values(body.filters).some((v) => (Array.isArray(v) ? v.length : v)))
    parts.push(`Their saved preferences (already applied to every search; mention them only if they matter): ${JSON.stringify(body.filters)}`);
  if (body.history.length)
    parts.push(`Earlier in this conversation (the new message may answer or refine it):\n${body.history.map((h) => `- They said "${h.prompt}". You replied: ${h.reply}`).join("\n")}`);
  return parts.join("\n");
}

// POST /api/ai/canvas — NDJSON stream of {type: status|plan|search|canvas|error|done}.
export async function POST(req: Request) {
  const limited = rateLimited(req, "canvas", 8);
  if (limited) return limited;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(req));
  } catch (err) {
    return fail(err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid request.") : "Invalid request.", 400);
  }
  const provider = body.provider as Provider;
  const tokens = await getActiveSession(provider, await aiOwner());
  if (!tokens) return fail(`Connect your ${provider === "codex" ? "ChatGPT" : "Grok"} account first.`, 401);

  const encoder = new TextEncoder();
  const signal = req.signal;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        const today = new Date().toISOString().slice(0, 10);
        send({ type: "status", text: "Reading your request" });
        const planModel = await resolveModel(provider, body.model, "fast");
        const planText = await complete({ provider, tokens, model: planModel, system: planSystemPrompt(today), user: userPrompt(body), effort: "low", signal });
        const plan = parsePlan(planText, today);
        send({ type: "plan", plan });
        if (!plan.searches.length) {
          send({ type: "canvas", canvas: { headline: plan.question ?? "Tell me a bit more about the trip.", summary: plan.understanding, picks: [], tips: [], followups: [] }, options: {}, hacks: [] });
          return;
        }

        const outcomes = await pool(plan.searches, SEARCH_CONCURRENCY, async (search, index): Promise<SearchOutcome> => {
          send({ type: "search", index, state: "running" });
          try {
            const result = await runSearch(SearchQuerySchema.parse({ ...toQuery(search), ...(body.filters ?? {}) }), signal, { calendarMs: 12_000 });
            const cheapest = result.itineraries.reduce<number | null>((m, it) => (m === null || it.price < m ? it.price : m), null);
            send({ type: "search", index, state: "done", count: result.itineraries.length, cheapest });
            return { search, itineraries: result.itineraries, hacks: result.hacks };
          } catch (err) {
            const error = err instanceof Error ? err.message : "Search failed.";
            send({ type: "search", index, state: "error", error });
            return { search, itineraries: [], hacks: [], error };
          }
        });

        const { lines, refs } = buildCandidates(outcomes);
        if (!refs.size) {
          send({ type: "error", error: "None of the searches found flights. Try other dates or airports." });
          return;
        }
        send({ type: "status", text: "Comparing the options" });
        const model = await resolveModel(provider, body.model, "main");
        const canvasText = await complete({
          provider,
          tokens,
          model,
          system: CANVAS_SYSTEM_PROMPT,
          user: `${userPrompt(body)}\n\nLive results:\n${lines}`,
          effort: "medium",
          signal,
        });
        const canvas = parseCanvas(canvasText, refs);
        const options = Object.fromEntries(canvas.picks.map((p) => [p.ref, { itinerary: refs.get(p.ref)!, search: Number(p.ref.slice(1).split("-")[0]) - 1 }]));
        const hacks = outcomes.flatMap((o) => o.hacks.map((h) => ({ ...h, search: o.search.label }))).filter((h) => h.saving > 0).sort((a, b) => b.saving - a.saving).slice(0, 4);
        send({ type: "canvas", canvas, options, hacks });
      } catch (err) {
        if (!signal.aborted) {
          const message = err instanceof ModelError ? err.message : err instanceof z.ZodError || err instanceof SyntaxError ? "The AI answer was not in the expected shape. Try again." : err instanceof Error ? err.message : "Something went wrong.";
          console.error("[canvas] failed:", err instanceof Error ? err.message : err);
          send({ type: "error", error: message });
        }
      } finally {
        send({ type: "done" });
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

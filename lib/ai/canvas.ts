import { z } from "zod";
import { airlineName } from "../airlines";
import { totalMinutes, totalStops, type Hack } from "../hacks";
import { CABINS, STOPS, type Itinerary, type SearchQueryInput } from "../types";

// The AI canvas: (1) the model turns a request into a handful of concrete
// searches, (2) the server runs them against live fares, (3) the model picks
// and explains the best options. The model only ever cites options by ref, so
// every price on the canvas comes from real search results.

export const MAX_SEARCHES = 5;
export const PER_SEARCH_CANDIDATES = 6;

const Iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PlannedSearchSchema = z.object({
  label: z.string().min(1).max(80),
  why: z.string().max(240).default(""),
  from: z.array(Iata).min(1).max(6),
  to: z.array(Iata).min(1).max(6),
  depart: IsoDate,
  return: IsoDate.nullable().default(null),
  cabin: z.enum(CABINS).default("ECONOMY"),
  stops: z.enum(STOPS).default("ANY"),
  adults: z.number().int().min(1).max(9).default(1),
  bags: z.number().int().min(0).max(2).default(0),
  nearby: z.boolean().default(true),
  flexible: z.boolean().default(false),
});

export const PlanSchema = z.object({
  understanding: z.string().max(400).default(""),
  assumptions: z.array(z.string().max(200)).max(6).default([]),
  searches: z.array(PlannedSearchSchema).max(MAX_SEARCHES).default([]),
  question: z.string().max(300).nullable().default(null),
});

export type PlannedSearch = z.infer<typeof PlannedSearchSchema>;
export type Plan = z.infer<typeof PlanSchema>;

export const PickSchema = z.object({
  ref: z.string(),
  title: z.string().max(80),
  why: z.string().max(400),
  tradeoff: z.string().max(240).nullable().default(null),
  tag: z.enum(["best", "cheapest", "fastest", "comfort", "hack", "alternative"]).default("alternative"),
});

export const CanvasSchema = z.object({
  headline: z.string().max(140),
  summary: z.string().max(600).default(""),
  picks: z.array(PickSchema).max(6).default([]),
  tips: z.array(z.string().max(240)).max(5).default([]),
  followups: z.array(z.string().max(100)).max(4).default([]),
});

export type Pick = z.infer<typeof PickSchema>;
export type Canvas = z.infer<typeof CanvasSchema>;

/** Pull the first JSON object out of model text (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export function parsePlan(text: string, today: string): Plan {
  const plan = PlanSchema.parse(extractJson(text));
  // Drop searches in the past or with a return before departure instead of failing the whole plan.
  const searches = plan.searches.filter((s) => s.depart > today && (!s.return || s.return >= s.depart));
  return { ...plan, searches };
}

export function toQuery(s: PlannedSearch): SearchQueryInput {
  return {
    from: s.from,
    to: s.to,
    depart: s.depart,
    return: s.return,
    cabin: s.cabin,
    stops: s.stops,
    adults: s.adults,
    bags: s.bags,
    nearby: s.nearby,
    flexible: s.flexible,
    split: true,
  };
}

export function planSystemPrompt(today: string): string {
  return `You plan flight searches for Contrail, a flight search tool with live Google Flights fares.
Today is ${today}. Turn the traveller's request into up to ${MAX_SEARCHES} concrete searches that together find the best options.
Use travel hacks where they could help: nearby airports (list several airport codes, e.g. SFO, OAK, SJC), shifting dates by a day or two, flying on cheaper weekdays, one-way vs round trip, a different cabin when the gap might be small.
Rules:
- Airports are three-letter IATA codes. Pick the airports a local would consider.
- Dates are YYYY-MM-DD and must be after today. Resolve phrases like "Thanksgiving week" or "next month" to real dates.
- Each search should test a different idea. Do not repeat the same search.
- If the request has no destination or no timeframe at all, return no searches and ask one short question.
Reply with JSON only, no prose:
{"understanding": "one sentence", "assumptions": ["..."], "question": null,
 "searches": [{"label": "short name", "why": "the idea this tests", "from": ["SFO"], "to": ["JFK"], "depart": "YYYY-MM-DD", "return": "YYYY-MM-DD or null", "cabin": "ECONOMY|PREMIUM_ECONOMY|BUSINESS|FIRST", "stops": "ANY|0|1|2", "adults": 1, "bags": 0, "nearby": true, "flexible": false}]}`;
}

export const CANVAS_SYSTEM_PROMPT = `You are Contrail's flight advisor. You get live search results as numbered options (refs like S1-2) and travel hacks the search found.
Pick the 3 to 6 options that best serve the traveller's request and explain each in plain words: the real reason to choose it and its main tradeoff.
Rules:
- Only cite refs that appear in the data. Never invent prices, times, or flights; the app shows the real numbers next to your words.
- Prefer airline-direct style itineraries over self-transfers; call out self-transfers, overnight layovers, very short connections (under 60 min) and long ones (over 4 h).
- Treat a few dollars as noise. Comfort and reliability matter.
- Keep each "why" under 40 words. Plain, specific, no hype.
Reply with JSON only:
{"headline": "one line answer", "summary": "two sentences max", "picks": [{"ref": "S1-2", "title": "short", "why": "...", "tradeoff": "... or null", "tag": "best|cheapest|fastest|comfort|hack|alternative"}], "tips": ["practical tip"], "followups": ["a short follow-up the traveller might ask"]}`;

function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

/** A compact, model-friendly line for one itinerary. */
export function describe(ref: string, it: Itinerary): string {
  const parts = it.slices.map((s, i) => {
    const first = s.legs[0];
    const last = s.legs[s.legs.length - 1];
    const airlines = [...new Set(s.legs.map((l) => airlineName(l.airline.code, l.airline.name)))].join("+");
    const lay = s.layovers.map((l) => `${l.airport ?? "?"} ${l.minutes}m${l.overnight ? " overnight" : ""}`).join(", ");
    const flags = [s.self_transfer ? "SELF-TRANSFER" : "", first.legroom ? `legroom ${first.legroom}` : ""].filter(Boolean).join(" ");
    return `${i === 0 ? "out" : "back"} ${first.depart.slice(0, 10)} ${first.from} ${hhmm(first.depart)} → ${last.to} ${hhmm(last.arrive)} ${airlines} ${Math.round(s.minutes / 6) / 10}h ${s.stops} stop${s.stops === 1 ? "" : "s"}${lay ? ` via ${lay}` : ""}${flags ? ` ${flags}` : ""}`;
  });
  return `${ref} $${Math.round(it.price)} total ${Math.round(totalMinutes(it) / 6) / 10}h ${totalStops(it)} stops | ${parts.join(" | ")}`;
}

export type SearchOutcome = { search: PlannedSearch; itineraries: Itinerary[]; hacks: Hack[]; error?: string };

export function buildCandidates(outcomes: SearchOutcome[]): { lines: string; refs: Map<string, Itinerary> } {
  const refs = new Map<string, Itinerary>();
  const blocks = outcomes.map((o, i) => {
    const header = `Search S${i + 1}: ${o.search.label} (${o.search.from.join("/")} → ${o.search.to.join("/")}, ${o.search.depart}${o.search.return ? ` to ${o.search.return}` : ""}${o.search.cabin !== "ECONOMY" ? `, ${o.search.cabin}` : ""})`;
    if (o.error) return `${header}\n  failed: ${o.error}`;
    const picked = o.itineraries.slice(0, PER_SEARCH_CANDIDATES);
    const lines = picked.map((it, j) => {
      const ref = `S${i + 1}-${j + 1}`;
      refs.set(ref, it);
      return `  ${describe(ref, it)}`;
    });
    const hacks = o.hacks.map((h) => `  hack: ${h.title}. ${h.detail}`);
    return [header, ...(lines.length ? lines : ["  no flights found"]), ...hacks].join("\n");
  });
  return { lines: blocks.join("\n\n"), refs };
}

export function parseCanvas(text: string, refs: Map<string, Itinerary>): Canvas {
  const canvas = CanvasSchema.parse(extractJson(text));
  const seen = new Set<string>();
  const picks = canvas.picks.filter((p) => {
    const ref = p.ref.trim().toUpperCase();
    if (!refs.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  }).map((p) => ({ ...p, ref: p.ref.trim().toUpperCase() }));
  return { ...canvas, picks };
}

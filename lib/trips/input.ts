import { z } from "zod";
import { CanvasSchema, PlanSchema, PlannedSearchSchema, toQuery } from "../ai/canvas";
import { ALLIANCES, AirlineCode, SearchQuerySchema, type SearchQuery } from "../types";

// What the browser sends to save a Plan shortlist or change its alerts. The
// server rebuilds the searches from the plan, so the stored queries are always valid.

export const MAX_TRIPS = 20;
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const Price = z.number().positive().max(1_000_000);

/** The shortlist as shown in Plan. Itineraries are kept as given: only their owner ever sees them. */
export const SnapshotSchema = z.object({
  prompt: z.string().max(1200),
  plan: PlanSchema,
  canvas: CanvasSchema,
  options: z.record(z.string().max(20), z.object({ itinerary: z.record(z.string(), z.unknown()), search: z.number().int().min(0) })),
  hacks: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
  // How each search went, so the reopened shortlist shows the same progress list.
  searches: z
    .array(z.object({ state: z.enum(["waiting", "running", "done", "error"]), count: z.number().int().min(0).nullish(), cheapest: z.number().nullish(), error: z.string().max(300).nullish() }))
    .max(5)
    .default([]),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const SaveTripSchema = z.object({
  snapshot: SnapshotSchema,
  searches: z.array(PlannedSearchSchema).min(1).max(5),
  // The traveller's filters at save time, applied to every re-check.
  filters: z
    .object({
      alliances: z.array(z.enum(ALLIANCES)).max(3),
      avoidAirlines: z.array(AirlineCode).max(20),
      preferAirlines: z.array(AirlineCode).max(10),
      noBasicEconomy: z.boolean(),
      avoidRedEyes: z.boolean(),
      avoidSelfTransfer: z.boolean(),
    })
    .partial()
    .default({}),
  price: Price,
});
export type SaveTrip = z.infer<typeof SaveTripSchema>;

export const UpdateAlertsSchema = z
  .object({
    alertDrop: z.boolean(),
    targetPrice: Price.nullable(),
    remindOn: IsoDate.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");
export type UpdateAlerts = z.infer<typeof UpdateAlertsSchema>;

export function buildQueries(input: SaveTrip): SearchQuery[] {
  return input.searches.map((s) => SearchQuerySchema.parse({ ...toQuery(s), ...input.filters }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** "SFO → MAA · Dec 7 – Dec 20", from the first search. */
export function tripTitle(q: SearchQuery): string {
  const dates = q.return ? `${shortDay(q.depart)} – ${shortDay(q.return)}` : shortDay(q.depart);
  return `${q.from.join("/")} → ${q.to.join("/")} · ${dates}`;
}

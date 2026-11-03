import { z } from "zod";

// The trip organizer's shapes ("journeys" internally, "Trips" in the UI),
// shared by parsers, the database layer, the API and the UI.

export const KINDS = ["flight", "stay", "dining", "activity", "transport", "note"] as const;
export const STATUSES = ["booked", "planned", "suggested", "cancelled"] as const;
export const SOURCES = ["manual", "email", "flint", "wanderlog", "ai"] as const;

export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type Source = (typeof SOURCES)[number];

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
export const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a HH:MM time.");

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().default(null);

/** Kind-specific facts. Everything optional: sources know different things. */
export const DetailsSchema = z
  .object({
    airline: z.string().max(80).optional(),
    flightNumber: z.string().max(12).optional(),
    from: z.string().max(80).optional(),
    to: z.string().max(80).optional(),
    address: z.string().max(240).optional(),
    phone: z.string().max(40).optional(),
    price: z.number().nonnegative().max(1_000_000).optional(),
    currency: z.string().max(3).optional(),
    url: z.url().max(2000).optional(),
    cuisine: z.string().max(60).optional(),
    priceLevel: z.string().max(4).optional(),
    why: z.string().max(400).optional(),
    reserve: z.boolean().optional(),
    meal: z.enum(["breakfast", "lunch", "dinner"]).optional(),
    rating: z.number().min(0).max(5).optional(),
    note: z.string().max(2000).optional(),
    guests: z.number().int().min(1).max(30).optional(),
    provider: z.string().max(80).optional(),
    /** "g:<Google place id>" or "osm:<id>": opens the details panel. */
    placeId: z.string().max(300).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    /** When the location was looked up; Google allows keeping coordinates 30 days. */
    locatedAt: z.number().int().optional(),
    /** When a lookup last found nothing trustworthy; tried again a week later. */
    locateFailedAt: z.number().int().optional(),
  })
  .strict();
export type Details = z.infer<typeof DetailsSchema>;

/** An item as a parser or the traveller describes it, before it has an id or a trip. */
export const DraftItemSchema = z.object({
  kind: z.enum(KINDS),
  status: z.enum(STATUSES).default("booked"),
  title: text(160),
  startDate: IsoDate,
  startTime: Clock.nullable().default(null),
  endDate: IsoDate.nullable().default(null),
  endTime: Clock.nullable().default(null),
  place: optText(160),
  confirmation: optText(40),
  details: DetailsSchema.default({}),
});
export type DraftItem = z.infer<typeof DraftItemSchema>;

export type Item = DraftItem & { id: string; journeyId: string | null; source: Source; dedupeKey: string | null; updatedAt: number };

export type Journey = {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  source: Source;
  createdAt: number;
};

export type JourneyWithItems = Journey & { items: Item[] };

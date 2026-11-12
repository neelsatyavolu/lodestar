import { z } from "zod";

// The trip organizer's shapes ("journeys" internally, "Trips" in the UI),
// shared by parsers, the database layer, the API and the UI.

export const KINDS = ["flight", "stay", "dining", "activity", "transport", "note"] as const;
export const STATUSES = ["booked", "planned", "suggested", "cancelled"] as const;
export const SOURCES = ["manual", "email", "flint", "wanderlog", "ai", "agent"] as const;

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
    /** Needs booking: a planned item with this set is on the To book list. */
    reserve: z.boolean().optional(),
    /** Book before this day. */
    bookBy: IsoDate.optional(),
    /** Expected cost while there is no price yet. */
    estimate: z.number().nonnegative().max(1_000_000).optional(),
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
    /** Which search found nothing: Google still tries what OpenStreetMap couldn't place. */
    locateFailedWith: z.enum(["google", "osm"]).optional(),
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

export const TRIP_TYPES = ["city", "beach", "road", "family", "adventure", "ski", "business", "other"] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export type Journey = {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  travelers: number | null;
  tripType: TripType | null;
  /** The secret share link's token, when sharing is on. */
  shareToken: string | null;
  /** Set on a trip someone else shared with you: your role and the owner's name. */
  access?: { role: "editor" | "viewer"; owner: string };
  source: Source;
  createdAt: number;
};

export type JourneyWithItems = Journey & { items: Item[] };

export const COST_CATEGORIES = ["flights", "stays", "transport", "dining", "activities", "other"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** A checklist entry: "Renew passport", "Download offline maps". */
export type Task = { id: string; journeyId: string; title: string; done: boolean; due: string | null; section: string; position: number; source: Source };
/** A titled note: "How the week works", "Dietary needs". */
export type Note = { id: string; journeyId: string; title: string; body: string; position: number; source: Source };
/** A budget line that isn't an item: gas, resort fees, tips. */
export type Cost = { id: string; journeyId: string; label: string; amount: number; currency: string; category: CostCategory; paid: boolean; source: Source };

/** One trip with everything in it: what the trip page and agents work from. */
export type TripDetail = JourneyWithItems & { tasks: Task[]; notes: Note[]; costs: Cost[] };

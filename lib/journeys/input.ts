import { z } from "zod";
import { isProvider } from "../ai/providers";
import { Clock, COST_CATEGORIES, DraftItemSchema, IsoDate, STATUSES, TRIP_TYPES } from "./types";

// Request bodies for the Trips organizer API, validated at the boundary.

const Title = z.string().trim().min(1, "Give it a name.").max(160);
const City = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}\s,.'’()-]+$/u, "Use a place name, like Lisbon.");

const ordered = <T extends { startDate?: string | null; endDate?: string | null }>(v: T) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

const Travelers = z.number().int().min(1, "At least one traveller.").max(30);
const TripTypeField = z.enum(TRIP_TYPES);

export const NewJourneySchema = z
  .object({
    destination: City,
    startDate: IsoDate.nullable().default(null),
    endDate: IsoDate.nullable().default(null),
    title: Title.optional(),
    travelers: Travelers.nullable().default(null),
    tripType: TripTypeField.nullable().default(null),
  })
  .refine(ordered, "The trip ends before it starts.");

export const JourneyPatchSchema = z
  .object({ title: Title, destination: City.nullable(), startDate: IsoDate.nullable(), endDate: IsoDate.nullable(), travelers: Travelers.nullable(), tripType: TripTypeField.nullable() })
  .partial()
  .refine(ordered, "The trip ends before it starts.");

/** A hand-added item: the traveller's own plans are "planned" unless they say booked. */
export const NewItemSchema = DraftItemSchema.extend({ status: z.enum(["booked", "planned"]).default("planned") }).refine(ordered, "It ends before it starts.");

const Money = z.number().nonnegative().max(1_000_000);

/** Booking facts: a value sets one, null clears it. */
export const FactsSchema = z
  .object({
    reserve: z.boolean().nullable(),
    bookBy: IsoDate.nullable(),
    estimate: Money.nullable(),
    price: Money.nullable(),
    currency: z.string().regex(/^[A-Za-z]{3}$/, "Use a currency code, like USD.").transform((c) => c.toUpperCase()).nullable(),
    url: z.url({ protocol: /^https?$/ }).max(2000).nullable(),
    phone: z.string().trim().max(40).nullable(),
    address: z.string().trim().max(240).nullable(),
  })
  .partial()
  .strict();

export const ItemPatchSchema = z
  .object({
    status: z.enum(STATUSES),
    journeyId: z.uuid().nullable(),
    title: Title,
    startDate: IsoDate,
    startTime: Clock.nullable(),
    endDate: IsoDate.nullable(),
    endTime: Clock.nullable(),
    place: z.string().trim().max(160).nullable(),
    confirmation: z.string().trim().max(40).nullable(),
    note: z.string().trim().max(2000).nullable(),
    /** The place picked in the details panel: pins the item to it. */
    location: z.object({
      placeId: z.string().max(300).regex(/^(g|osm):[\w:.-]+$/),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      address: z.string().trim().max(240).nullable(),
    }),
    facts: FactsSchema,
  })
  .partial();

export const AiBodySchema = z.object({ provider: z.string().refine(isProvider, "Unknown provider.") });
export const SuggestSchema = AiBodySchema.extend({ kind: z.enum(["dining", "hotels"]) });

export const WanderlogSchema = z.object({
  session: z.string().trim().min(10, "Paste your Wanderlog session.").max(800),
  keys: z.array(z.string().regex(/^[A-Za-z0-9_-]{4,64}$/)).max(50).optional(),
});

// ---------- Checklist, notes, budget ----------

const Section = z.string().trim().min(1).max(60);

export const NewTaskSchema = z.object({ title: z.string().trim().min(1, "Say what to do.").max(200), due: IsoDate.nullable().default(null), section: Section.default("Before you go") });
export const TaskPatchSchema = z.object({ title: z.string().trim().min(1).max(200), done: z.boolean(), due: IsoDate.nullable(), section: Section }).partial();

export const NoteSchema = z.object({ title: z.string().trim().min(1, "Give the note a title.").max(120), body: z.string().trim().max(8000) });
export const NotePatchSchema = NoteSchema.partial();

export const NewCostSchema = z.object({
  label: z.string().trim().min(1, "Say what it's for.").max(120),
  amount: Money,
  currency: z.string().regex(/^[A-Za-z]{3}$/, "Use a currency code, like USD.").transform((c) => c.toUpperCase()).default("USD"),
  category: z.enum(COST_CATEGORIES).default("other"),
  paid: z.boolean().default(false),
});
export const CostPatchSchema = z.object({ label: z.string().trim().min(1).max(120), amount: Money, currency: z.string().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()), category: z.enum(COST_CATEGORIES), paid: z.boolean() }).partial();

// ---------- AI and sharing ----------

export const PLAN_PARTS = ["itinerary", "to_book", "checklist", "notes", "budget"] as const;
export type PlanPart = (typeof PLAN_PARTS)[number];
export const GenerateSchema = AiBodySchema.extend({ part: z.enum(PLAN_PARTS), wishes: z.string().trim().max(600).optional() });

export const ShareSchema = z.object({ on: z.boolean() });

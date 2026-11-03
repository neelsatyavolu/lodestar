import { z } from "zod";
import { isProvider } from "../ai/providers";
import { Clock, DraftItemSchema, IsoDate, STATUSES } from "./types";

// Request bodies for the Trips organizer API, validated at the boundary.

const Title = z.string().trim().min(1, "Give it a name.").max(160);
const City = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}\s,.'’()-]+$/u, "Use a place name, like Lisbon.");

const ordered = <T extends { startDate?: string | null; endDate?: string | null }>(v: T) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

export const NewJourneySchema = z
  .object({
    destination: City,
    startDate: IsoDate.nullable().default(null),
    endDate: IsoDate.nullable().default(null),
    title: Title.optional(),
  })
  .refine(ordered, "The trip ends before it starts.");

export const JourneyPatchSchema = z
  .object({ title: Title, destination: City.nullable(), startDate: IsoDate.nullable(), endDate: IsoDate.nullable() })
  .partial()
  .refine(ordered, "The trip ends before it starts.");

/** A hand-added item: the traveller's own plans are "planned" unless they say booked. */
export const NewItemSchema = DraftItemSchema.extend({ status: z.enum(["booked", "planned"]).default("planned") }).refine(ordered, "It ends before it starts.");

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
  })
  .partial();

export const AiBodySchema = z.object({ provider: z.string().refine(isProvider, "Unknown provider.") });
export const SuggestSchema = AiBodySchema.extend({ kind: z.enum(["dining", "hotels"]) });

export const WanderlogSchema = z.object({
  session: z.string().trim().min(10, "Paste your Wanderlog session.").max(800),
  keys: z.array(z.string().regex(/^[A-Za-z0-9_-]{4,64}$/)).max(50).optional(),
});

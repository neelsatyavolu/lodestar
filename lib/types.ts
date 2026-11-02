import { z } from "zod";

// Shapes returned by the fares service (fares/lodestar_fares). Parsed with zod
// at the boundary so a Google-side change fails loudly instead of rendering junk.

const Airline = z.object({ code: z.string(), name: z.string() });

export const LegSchema = z.object({
  from: z.string(),
  from_name: z.string().nullable(),
  to: z.string(),
  to_name: z.string().nullable(),
  depart: z.string(),
  arrive: z.string(),
  minutes: z.number(),
  airline: Airline,
  operating: Airline.nullable(),
  flight_number: z.string(),
  aircraft: z.string().nullable(),
  legroom: z.string().nullable(),
  overnight: z.boolean(),
  amenities: z.record(z.string(), z.unknown()).nullable(),
});

export const SliceSchema = z.object({
  minutes: z.number(),
  stops: z.number(),
  legs: z.array(LegSchema).min(1),
  layovers: z.array(
    z.object({
      airport: z.string().nullable(),
      city: z.string().nullable(),
      minutes: z.number(),
      overnight: z.boolean(),
      change_of_airport: z.boolean(),
    }),
  ),
  self_transfer: z.boolean(),
  co2_kg: z.number().nullable(),
  co2_delta_pct: z.number().nullable(),
});

export const ItinerarySchema = z.object({
  id: z.string(),
  price: z.number(),
  currency: z.string(),
  slices: z.array(SliceSchema).min(1),
  booking_url: z.url(),
  tfs: z.string().nullable(),
});

export const FlightsResponseSchema = z.object({
  itineraries: z.array(ItinerarySchema),
  round_trip: z.boolean(),
});

export const DatesResponseSchema = z.object({
  days: z.array(z.object({ depart: z.string(), return: z.string().nullable(), price: z.number() })),
  round_trip: z.boolean(),
});

const PolicySchema = z.object({
  carry_on: z.boolean().nullable(),
  checked_bag_fee: z.number().nullable(),
  checked_bag_included: z.boolean().nullable(),
  changes: z.string().nullable(),
  refunds: z.string().nullable(),
  seat_selection: z.string().nullable(),
});

export const BookingResponseSchema = z.object({
  sellers: z.array(
    z.object({
      name: z.string(),
      is_airline: z.boolean(),
      lowest: z.number(),
      fares: z.array(z.object({ name: z.string().nullable(), price: z.number(), features: z.array(z.string()), policy: PolicySchema })),
    }),
  ),
  insight: z.object({
    level: z.string().nullable(),
    typical_low: z.number().nullable(),
    typical_high: z.number().nullable(),
    unlikely_to_drop_below: z.number().nullable(),
    cheaper_than_usual_by: z.number().nullable(),
    summary: z.string().nullable(),
  }),
  booking_url: z.url(),
});

export type Leg = z.infer<typeof LegSchema>;
export type Slice = z.infer<typeof SliceSchema>;
export type Itinerary = z.infer<typeof ItinerarySchema>;
export type DayPrice = z.infer<typeof DatesResponseSchema>["days"][number];
export type BookingPage = z.infer<typeof BookingResponseSchema>;
export type FarePolicy = z.infer<typeof PolicySchema>;

export const CABINS = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const;
export type Cabin = (typeof CABINS)[number];
export const STOPS = ["ANY", "0", "1", "2"] as const;
export type MaxStops = (typeof STOPS)[number];

export const ALLIANCES = ["STAR_ALLIANCE", "ONEWORLD", "SKYTEAM"] as const;
export type AllianceName = (typeof ALLIANCES)[number];

export const Iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter airport code.");
export const AirlineCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2}$/, "Use a two-character airline code.");
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

/** What the browser (or the AI planner) asks the search API for. */
export const SearchQuerySchema = z
  .object({
    from: z.array(Iata).min(1).max(6),
    to: z.array(Iata).min(1).max(6),
    depart: IsoDate,
    return: IsoDate.nullable().default(null),
    cabin: z.enum(CABINS).default("ECONOMY"),
    stops: z.enum(STOPS).default("ANY"),
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    bags: z.number().int().min(0).max(2).default(0),
    nearby: z.boolean().default(true),
    flexible: z.boolean().default(true),
    split: z.boolean().default(true),
    // Traveller preferences (saved on an account, or set per search).
    alliances: z.array(z.enum(ALLIANCES)).max(3).default([]),
    avoidAirlines: z.array(AirlineCode).max(20).default([]),
    preferAirlines: z.array(AirlineCode).max(10).default([]),
    noBasicEconomy: z.boolean().default(false),
    avoidRedEyes: z.boolean().default(false),
    avoidSelfTransfer: z.boolean().default(true),
  })
  .refine((q) => !q.return || q.return >= q.depart, { message: "Return is before departure.", path: ["return"] })
  .refine((q) => q.adults + q.children <= 9, { message: "At most 9 travellers.", path: ["adults"] });

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchQueryInput = z.input<typeof SearchQuerySchema>;

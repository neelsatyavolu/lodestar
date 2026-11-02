import { z } from "zod";

// Shapes for Stays (hotel search), shared by the API routes, the fares client
// and the UI. Responses from the fares service are parsed here at the boundary.

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
export const MAX_NIGHTS = 30;
export const MAX_ADULTS = 8;

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export const StayQuerySchema = z
  .object({
    checkin: IsoDate,
    checkout: IsoDate,
    adults: z.number().int().min(1).max(MAX_ADULTS).default(2),
  })
  .refine((q) => nightsBetween(q.checkin, q.checkout) >= 1 && nightsBetween(q.checkin, q.checkout) <= MAX_NIGHTS, `A stay is 1 to ${MAX_NIGHTS} nights.`);
export type StayQuery = z.infer<typeof StayQuerySchema>;

export const StaysSearchSchema = z.intersection(
  StayQuerySchema,
  z.object({ city: z.string().trim().min(2, "Enter a city.").max(80).regex(/^[\p{L}\p{N}\s,.'’()-]+$/u, "Use a place name, like Lisbon.") }),
);
export type StaysSearch = z.infer<typeof StaysSearchSchema>;

export const HotelKey = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/, "Invalid hotel.");
export const StaysPricesSchema = z.intersection(StayQuerySchema, z.object({ key: HotelKey }));
export type StaysPrices = z.infer<typeof StaysPricesSchema>;

export const HotelSchema = z.object({
  key: HotelKey,
  name: z.string(),
  /** Google's "from" price per night, before taxes. */
  price: z.number(),
  deal_pct: z.number().nullable(),
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
  stars: z.number().nullable(),
  amenities: z.array(z.string()),
  image: z.url().nullable(),
});
export type Hotel = z.infer<typeof HotelSchema>;

export const OfferSchema = z.object({
  seller: z.string(),
  official: z.boolean(),
  nightly_base: z.number(),
  /** Per night with taxes and fees. */
  nightly: z.number(),
  /** The whole stay with taxes and fees. */
  total: z.number(),
  free_cancel_until: IsoDate.nullable(),
  url: z.url().nullable(),
});
export type Offer = z.infer<typeof OfferSchema>;

export const StaysSearchResponseSchema = z.object({ hotels: z.array(HotelSchema), url: z.url() });
export const StaysPricesResponseSchema = z.object({ offers: z.array(OfferSchema), url: z.url() });

export function nights(q: Pick<StayQuery, "checkin" | "checkout">): number {
  return nightsBetween(q.checkin, q.checkout);
}

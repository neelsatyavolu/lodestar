import { z } from "zod";
import { ALLIANCES, AirlineCode, CABINS, Iata, STOPS, type AllianceName } from "./types";

export { ALLIANCES, type AllianceName };

// A signed-in traveller's saved defaults. Shared by the API (validation), the
// search (filters and ranking) and the UI (form defaults).

export const ALLIANCE_LABEL: Record<AllianceName, string> = { STAR_ALLIANCE: "Star Alliance", ONEWORLD: "oneworld", SKYTEAM: "SkyTeam" };

const unique = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).max(max).transform((xs) => [...new Set(xs as unknown[])] as z.infer<T>[]);

export const PRICE_LEVELS = ["$", "$$", "$$$", "$$$$"] as const;
export const PACES = ["relaxed", "balanced", "packed"] as const;
/** Choices offered as chips; free text is allowed too, kept short and plain. */
export const CUISINE_CHOICES = ["Local food", "Seafood", "Italian", "Japanese", "Mexican", "Indian", "Thai", "Chinese", "Middle Eastern", "French", "Steakhouse", "Street food", "Cafés & bakeries", "Fine dining"];
export const DIETARY_CHOICES = ["Vegetarian", "Vegan", "Pescatarian", "Gluten-free", "Halal", "Kosher", "Dairy-free", "Nut allergy"];
export const INTEREST_CHOICES = ["Museums", "History", "Food tours", "Nature & hikes", "Beaches", "Nightlife", "Shopping", "Architecture", "Art & galleries", "Live music", "Sports", "Markets", "Wellness & spas", "Kid-friendly"];
export const HOTEL_PRIORITY_CHOICES = ["Walkable location", "Near transit", "Quiet", "Pool", "Gym", "Breakfast included", "Free cancellation", "Boutique", "Big chain points", "Views"];
const Taste = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N}\s&'’,.()/-]+$/u, "Use plain words.");

export const PreferencesSchema = z.object({
  homeAirports: unique(Iata, 4).default([]),
  alliances: unique(z.enum(ALLIANCES), 3).default([]),
  preferredAirlines: unique(AirlineCode, 10).default([]),
  avoidedAirlines: unique(AirlineCode, 20).default([]),
  cabin: z.enum(CABINS).default("ECONOMY"),
  stops: z.enum(STOPS).default("ANY"),
  adults: z.number().int().min(1).max(9).default(1),
  bags: z.number().int().min(0).max(2).default(0),
  avoidRedEyes: z.boolean().default(false),
  avoidSelfTransfer: z.boolean().default(true),
  noBasicEconomy: z.boolean().default(false),
  trustedOnly: z.boolean().default(true),
  nearby: z.boolean().default(true),
  flexible: z.boolean().default(true),
  split: z.boolean().default(true),
  // On the ground: steers Trips' dining plans and hotel picks.
  cuisines: unique(Taste, 12).default([]),
  dietary: unique(Taste, 8).default([]),
  diningBudget: z.enum(PRICE_LEVELS).nullable().default(null),
  interests: unique(Taste, 12).default([]),
  pace: z.enum(PACES).default("balanced"),
  hotelBudget: z.number().int().min(20).max(5000).nullable().default(null),
  hotelPriorities: unique(Taste, 8).default([]),
});

export type Preferences = z.infer<typeof PreferencesSchema>;
export const DEFAULT_PREFERENCES: Preferences = PreferencesSchema.parse({});

/** Stored JSON may predate a field; anything unreadable falls back to defaults field by field. */
export function readPreferences(raw: unknown): Preferences {
  const parsed = PreferencesSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(PreferencesSchema.shape) as (keyof Preferences)[]) {
    const field = PreferencesSchema.shape[key].safeParse(obj[key]);
    out[key] = field.success ? field.data : DEFAULT_PREFERENCES[key];
  }
  return out as Preferences;
}

import { z } from "zod";
import { ALLIANCES, AirlineCode, CABINS, Iata, STOPS, type AllianceName } from "./types";

export { ALLIANCES, type AllianceName };

// A signed-in traveller's saved defaults. Shared by the API (validation), the
// search (filters and ranking) and the UI (form defaults).

export const ALLIANCE_LABEL: Record<AllianceName, string> = { STAR_ALLIANCE: "Star Alliance", ONEWORLD: "oneworld", SKYTEAM: "SkyTeam" };

const unique = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).max(max).transform((xs) => [...new Set(xs as unknown[])] as z.infer<T>[]);

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

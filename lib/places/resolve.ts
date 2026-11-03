import { distanceKm } from "../airports";
import { normalize } from "./osm";
import type { LatLng, Suggestion } from "./types";

// Finding where a booking from email or an import is, with OpenStreetMap
// search (Google's text search needs none of this). A search's first answer
// is often wrong: "Sintra day trip" finds an aqueduct, a hotel's street
// address finds the park next door. So several searches are tried, from most
// to least specific, and an answer counts only when its name shares a word
// with the booking's and it lies near where the trip is.

export type Search = (q: string, near: LatLng | null, limit: number) => Promise<Suggestion[]>;
export type Want = { title: string; address: string | null; city: string | null };

/** Words that describe the plan rather than name the place. */
const FILLER = new Set(
  "the a an and at of in on to for with by day trip tour visit dinner lunch breakfast brunch drinks coffee check checkin checkout in out hike walk stay night reservation booking table party tickets ticket entry".split(" "),
);
/** How far from the trip's city an answer may be: a day trip, not another country. */
const MAX_KM = 250;

/** Words many places share, which say nothing about which one: "Hotel Aurora" is not "Hotel Central". */
const COMMON = new Set(
  "hotel hotels inn suites suite resort spa motel hostel lodge restaurant restaurante ristorante cafe coffee bar grill kitchen bistro pizzeria museum park center centre house club international airport station street avenue road beach city new san santa".split(" "),
);
/** Street-address words that don't pick out a street. */
const ADDRESS_WORDS = new Set("north south east west street avenue road drive boulevard lane court place way suite blvd ave".split(" "));

const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2 && !FILLER.has(w));
const distinctive = (s: string) => words(s).filter((w) => !COMMON.has(w));

/**
 * Does the answer's name agree with the booking's title? It must share the title's distinctive
 * words: one if the title has one ("Sintra"), two if it has more ("Hilton Garden Inn" needs both
 * Hilton and Garden). A title of only common words ("The Grill") must be the whole name.
 */
export function sameName(title: string, name: string): boolean {
  const n = new Set(words(name));
  const key = distinctive(title);
  if (!key.length) return words(title).length > 0 && words(title).length === n.size && words(title).every((w) => n.has(w));
  return key.filter((w) => n.has(w)).length >= Math.min(2, key.length);
}

/** Does an answer for a street address lie on that street? Its name or address must carry the street's name. */
export function onStreet(address: string, hit: Suggestion): boolean {
  const street = normalize(address.split(",")[0] ?? "")
    .split(" ")
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !ADDRESS_WORDS.has(w));
  const found = new Set(normalize(`${hit.name} ${hit.address ?? ""} ${hit.secondary}`).split(" "));
  return street.length > 0 && street.every((w) => found.has(w));
}

/** The title without "day trip", "dinner at" and the like: "Sintra day trip" → "Sintra". */
export const coreName = (title: string) =>
  normalize(title)
    .split(" ")
    .filter((w) => !FILLER.has(w))
    .join(" ");

const near = (a: LatLng, b: LatLng | null) => !b || distanceKm({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }) <= MAX_KM;

/**
 * The booking's place, or null when nothing trustworthy turns up. `anchor` is where the trip is
 * (its city, looked up once); answers far from it are someone else's place of the same name.
 */
export async function resolvePlace(want: Want, anchor: LatLng | null, search: Search): Promise<Suggestion | null> {
  const where = want.address ?? want.city;
  const named = (rows: Suggestion[]) => rows.find((r) => r.location && near(r.location, anchor) && sameName(want.title, r.name)) ?? null;

  const full = await search([want.title, where].filter(Boolean).join(", "), anchor, 5);
  const byName = named(full);
  if (byName) return byName;

  // The name with just the city: an email's address can be wrong or too detailed for OpenStreetMap.
  if (want.address && want.city) {
    const inCity = named(await search(`${want.title}, ${want.city}`, anchor, 5));
    if (inCity) return inCity;
  }

  const core = coreName(want.title);
  if (core && core !== normalize(want.title)) {
    const short = named(await search([core, want.city].filter(Boolean).join(", "), anchor, 5));
    if (short) return short;
  }

  // The street address alone: right building or next door, close enough for a pin, but only
  // when the answer is on that street.
  if (want.address) {
    const spot = (await search(want.address, anchor, 3)).find((r) => r.location && near(r.location, anchor) && onStreet(want.address!, r));
    if (spot) return spot;
  }
  return null;
}

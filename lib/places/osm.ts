import { airport, searchAirports, distanceKm } from "../airports";
import { PlacesError } from "./google";
import { kindOf, type LatLng, type Suggestion } from "./types";

// OpenStreetMap search through Photon (komoot): free and keyless, with names,
// addresses and locations but no ratings, hours or photos. Used when no Google
// key is set. Photon's own order favours exact name matches over what people
// mean ("sky harbor" puts a parking lot above the airport), so results are
// re-ranked: places people visit first, roads, land-use areas and bus stops
// last, nearer the trip first, the same place mapped twice shown once. Our
// airport list adds airports by city or code. Photon asks for fair use and
// answers 503 to bursts, so answers are cached and a refusal is retried once;
// if it still fails, the search throws, so "no answer" is never mistaken for
// "no such place".

const PHOTON = "https://photon.komoot.io/api/";
const TIMEOUT_MS = 8_000;
const FETCH_LIMIT = 15;
const RETRY_MS = 700;
const CACHE_MS = 6 * 3_600_000;
const CACHE_MAX = 500;
/** Same-named results with the same area line this close, or this close at all, are one place mapped twice. */
const SAME_PLACE_KM = 2;
const SAME_SPOT_KM = 0.1;
/** Airports this far from the trip are another city's, unless asked for by code. */
const FAR_AIRPORT_KM = 800;

type Feature = { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> };

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
export const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** What a result is, by its OpenStreetMap tag: shown under the name and used for ranking. */
const LABELS: Record<string, string> = {
  aerodrome: "Airport", hotel: "Hotel", motel: "Motel", hostel: "Hostel", guest_house: "Guest house", apartment: "Apartment", resort: "Resort",
  restaurant: "Restaurant", cafe: "Cafe", bar: "Bar", pub: "Pub", fast_food: "Fast food", bakery: "Bakery", ice_cream: "Ice cream",
  museum: "Museum", gallery: "Gallery", attraction: "Attraction", viewpoint: "Viewpoint", zoo: "Zoo", aquarium: "Aquarium", theme_park: "Theme park",
  park: "Park", garden: "Garden", nature_reserve: "Nature reserve", beach: "Beach", peak: "Peak", stadium: "Stadium", theatre: "Theater", cinema: "Cinema",
  station: "Station", city: "City", town: "Town", village: "Village", suburb: "Neighborhood", neighbourhood: "Neighborhood", mall: "Mall",
  marketplace: "Market", place_of_worship: "Place of worship", castle: "Castle", monument: "Monument", memorial: "Memorial", winery: "Winery",
  car_rental: "Car rental", ferry_terminal: "Ferry terminal", golf_course: "Golf course", spa: "Spa", trailhead: "Trailhead",
};

/** Points for what kind of thing a result is: somewhere to go beats a road or a zoning area. */
function typeScore(key: string, value: string, type: string, addressLike: boolean): number {
  if (key === "aeroway" && value === "aerodrome") return 6;
  if (key === "tourism" || key === "historic") return value === "information" ? -2 : 4;
  if (key === "place") return ["city", "town", "village"].includes(value) ? 4 : 2;
  if (key === "amenity") return ["parking", "parking_space", "bicycle_parking", "taxi", "toilets", "atm", "bench", "waste_basket", "post_box"].includes(value) ? -5 : 3;
  if (key === "leisure" || key === "natural" || key === "shop" || key === "railway" || key === "craft") return value === "stop" || value === "platform" ? -3 : 2;
  if (key === "highway") return value === "bus_stop" || value === "platform" ? -5 : addressLike ? 2 : -3;
  if (key === "landuse" || key === "boundary") return -6;
  if (key === "building" || key === "office") return type === "house" && addressLike ? 1 : -1;
  return 0;
}

function nameScore(name: string, q: string): number {
  const n = normalize(name);
  const words = normalize(q).split(" ").filter((w) => w.length > 1);
  if (!words.length) return 0;
  const hit = words.filter((w) => n.includes(w)).length / words.length;
  return hit * 6 + (n.startsWith(normalize(q)) ? 2 : 0) + (n === normalize(q) ? 2 : 0);
}

type Ranked = Suggestion & { score: number };

function toSuggestion(f: Feature, q: string, near: LatLng | null, index: number): Ranked | null {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const street = [s(p.housenumber), s(p.street)].filter(Boolean).join(" ");
  const name = s(p.name) ?? street;
  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;
  const key = s(p.osm_key) ?? "";
  const value = s(p.osm_value) ?? "";
  const city = s(p.city) ?? s(p.town) ?? s(p.village) ?? s(p.county);
  const area = [city !== name ? city : null, s(p.state), s(p.country)].filter(Boolean).join(", ");
  const addressLike = /^\d/.test(q.trim());
  const km = near ? distanceKm({ lat: near.lat, lon: near.lng }, { lat, lon: lng }) : 0;
  const score = typeScore(key, value, s(p.type) ?? "", addressLike) + nameScore(name, q) - Math.min(5, km / 60) - index * 0.15;
  return {
    id: `osm:${s(p.osm_type) ?? "N"}${String(p.osm_id ?? "")}`,
    name,
    secondary: [street && street !== name ? street : null, area].filter(Boolean).join(", "),
    category: LABELS[value] ?? null,
    kind: kindOf([value, key]),
    location: { lat, lng },
    address: [street, area].filter(Boolean).join(", ") || null,
    score,
  };
}

/** Airports from our own list when the search names one ("phoenix airport", "PHX"). */
function airportHits(q: string, near: LatLng | null): Ranked[] {
  const words = normalize(q);
  const code = /^[a-z]{3}$/.test(words) ? airport(words.toUpperCase()) : undefined;
  const asked = /\b(airport|airfield|aeropuerto|aeroport|flughafen)\b/.test(words);
  const found = code ? [code] : asked ? searchAirports(words.replace(/\b(international|intl|airport|airfield|aeropuerto|aeroport|flughafen)\b/g, "").trim(), 4).map((a) => airport(a.code)) : [];
  const kmFrom = (a: { lat: number; lon: number }) => (near ? distanceKm({ lat: near.lat, lon: near.lng }, a) : 0);
  return found
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
    // "phoenix airport" on a trip to Arizona means Phoenix, not Sanya Phoenix in China; a typed code means that airport.
    .filter((a) => code !== undefined || kmFrom(a) < FAR_AIRPORT_KM)
    .map((a, i) => {
      const km = kmFrom(a);
      return {
        id: `osm:iata-${a.code}`,
        name: a.name,
        secondary: `${a.code} · ${a.city}, ${a.country}`,
        category: "Airport",
        kind: "activity" as const,
        location: { lat: a.lat, lng: a.lon },
        address: `${a.name}, ${a.city}`,
        score: 14 + a.size - i - Math.min(5, km / 60),
      };
    });
}

const km = (a: LatLng, b: LatLng) => distanceKm({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });

/**
 * Drops the second of two results that are really one place: the same feature, the same name
 * and area mapped twice (a building and its grounds), or the same name on the same spot.
 * Two Starbucks on different streets are two places and both stay.
 */
export function dedupe<T extends Suggestion>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const r of rows) {
    const twin = kept.some((k) => {
      if (k.id === r.id) return true;
      if (normalize(k.name) !== normalize(r.name) || !k.location || !r.location) return false;
      const apart = km(k.location, r.location);
      return apart < SAME_SPOT_KM || (k.secondary === r.secondary && apart < SAME_PLACE_KM);
    });
    if (!twin) kept.push(r);
  }
  return kept;
}

const cache = new Map<string, { at: number; rows: Feature[] }>();

async function photon(q: string, near: LatLng | null, fetcher: typeof fetch): Promise<Feature[]> {
  const params = new URLSearchParams({ q, limit: String(FETCH_LIMIT), lang: "en" });
  if (near) {
    // Bias toward the trip at city scale, without hiding famous places farther away.
    params.set("lat", near.lat.toFixed(3));
    params.set("lon", near.lng.toFixed(3));
    params.set("zoom", "10");
    params.set("location_bias_scale", "0.3");
  }
  const key = params.toString();
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.rows;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, RETRY_MS));
    let res: Response;
    try {
      res = await fetcher(`${PHOTON}?${key}`, { headers: { "User-Agent": "Lodestar (lodestar.xanom.co)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      continue;
    }
    if (res.status === 503 || res.status === 429 || res.status >= 500) continue;
    if (!res.ok) break;
    const rows = ((await res.json().catch(() => ({}))) as { features?: Feature[] }).features ?? [];
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), rows });
    return rows;
  }
  throw new PlacesError("Place search isn't answering. Try again in a moment.", 503);
}

export async function osmSearch(q: string, near: LatLng | null, limit = 6, fetcher: typeof fetch = fetch): Promise<Suggestion[]> {
  const features = await photon(q, near, fetcher);
  const ranked = [...airportHits(q, near), ...features.map((f, i) => toSuggestion(f, q, near, i)).filter((x): x is Ranked => x !== null)].sort((a, b) => b.score - a.score);
  return dedupe(ranked)
    .slice(0, limit)
    .map(({ score, ...rest }) => (void score, rest));
}

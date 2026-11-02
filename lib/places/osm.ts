import { kindOf, type LatLng, type Suggestion } from "./types";

// OpenStreetMap search through Photon (komoot): free and keyless, with names,
// addresses and locations but no ratings, hours or photos. Used when no Google
// key is set. Photon asks for fair use, so callers are rate-limited.

const PHOTON = "https://photon.komoot.io/api/";
const TIMEOUT_MS = 8_000;

type Feature = { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> };

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function toSuggestion(f: Feature): Suggestion | null {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const name = s(p.name) ?? [s(p.housenumber), s(p.street)].filter(Boolean).join(" ");
  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;
  const street = [s(p.housenumber), s(p.street)].filter(Boolean).join(" ");
  const area = [s(p.city) ?? s(p.county), s(p.state), s(p.country)].filter(Boolean).join(", ");
  const address = [street, area].filter(Boolean).join(", ") || null;
  return {
    id: `osm:${s(p.osm_type) ?? "N"}${String(p.osm_id ?? "")}`,
    name,
    secondary: area,
    kind: kindOf([s(p.osm_value) ?? "", s(p.osm_key) ?? ""]),
    location: { lat, lng },
    address,
  };
}

export async function osmSearch(q: string, near: LatLng | null, limit = 6, fetcher: typeof fetch = fetch): Promise<Suggestion[]> {
  const params = new URLSearchParams({ q, limit: String(limit), lang: "en" });
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
  }
  try {
    const res = await fetcher(`${PHOTON}?${params}`, { headers: { "User-Agent": "Lodestar (lodestar.xanom.co)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const body = (await res.json()) as { features?: Feature[] };
    return (body.features ?? []).map(toSuggestion).filter((x): x is Suggestion => x !== null);
  } catch {
    return [];
  }
}

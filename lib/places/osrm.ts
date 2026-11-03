import type { LatLng, Leg } from "./types";

// Drive times without Google: the public OSRM router over OpenStreetMap roads.
// One request covers a whole day (every stop as a waypoint), which keeps us
// well inside its fair-use limit of about one request a second.

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const TIMEOUT_MS = 8_000;

/** The drive between each stop and the next, in order; null for a leg it couldn't route. */
export async function osrmLegs(stops: LatLng[], fetcher: typeof fetch = fetch): Promise<(Leg | null)[]> {
  const none = stops.slice(1).map(() => null);
  if (stops.length < 2) return [];
  const path = stops.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  try {
    const res = await fetcher(`${OSRM}${path}?overview=false`, { headers: { "User-Agent": "Lodestar (lodestar.xanom.co)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return none;
    const body = (await res.json()) as { code?: string; routes?: { legs?: { duration?: number; distance?: number }[] }[] };
    const legs = body.code === "Ok" ? body.routes?.[0]?.legs : undefined;
    if (!legs || legs.length !== stops.length - 1) return none;
    return legs.map((l) => (typeof l.duration === "number" && typeof l.distance === "number" && l.duration > 0 ? { seconds: Math.round(l.duration), meters: Math.round(l.distance) } : null));
  } catch {
    return none;
  }
}

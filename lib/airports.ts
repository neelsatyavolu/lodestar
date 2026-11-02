import data from "@/data/airports.json";

export type Airport = { code: string; name: string; city: string; country: string; lat: number; lon: number; size: number };

const AIRPORTS = data as Airport[];
const BY_CODE = new Map(AIRPORTS.map((a) => [a.code, a]));

/** City codes people type that Google expands to several airports. */
export const METROS: Record<string, { name: string; codes: string[] }> = {
  NYC: { name: "New York (all airports)", codes: ["JFK", "EWR", "LGA"] },
  LON: { name: "London (all airports)", codes: ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"] },
  PAR: { name: "Paris (all airports)", codes: ["CDG", "ORY", "BVA"] },
  TYO: { name: "Tokyo (all airports)", codes: ["HND", "NRT"] },
  CHI: { name: "Chicago (all airports)", codes: ["ORD", "MDW"] },
  WAS: { name: "Washington DC (all airports)", codes: ["IAD", "DCA", "BWI"] },
  BAY: { name: "SF Bay Area (all airports)", codes: ["SFO", "OAK", "SJC"] },
  LAX: { name: "Los Angeles area", codes: ["LAX", "BUR", "LGB", "SNA", "ONT"] },
  MIL: { name: "Milan (all airports)", codes: ["MXP", "LIN", "BGY"] },
  ROM: { name: "Rome (all airports)", codes: ["FCO", "CIA"] },
  SEL: { name: "Seoul (all airports)", codes: ["ICN", "GMP"] },
  OSA: { name: "Osaka (all airports)", codes: ["KIX", "ITM", "UKB"] },
  STO: { name: "Stockholm (all airports)", codes: ["ARN", "BMA", "NYO"] },
  YTO: { name: "Toronto (all airports)", codes: ["YYZ", "YTZ"] },
  SAO: { name: "São Paulo (all airports)", codes: ["GRU", "CGH", "VCP"] },
  BUE: { name: "Buenos Aires (all airports)", codes: ["EZE", "AEP"] },
  MOW: { name: "Moscow (all airports)", codes: ["SVO", "DME", "VKO"] },
};

export function airport(code: string): Airport | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** Expand a typed code: a metro code becomes its airports, an airport stays itself. */
export function expandCode(code: string): string[] {
  const upper = code.toUpperCase();
  // LAX is both an airport and our LA-area group; treat a bare LAX as the airport.
  if (upper !== "LAX" && METROS[upper]) return METROS[upper].codes.filter((c) => BY_CODE.has(c));
  return BY_CODE.has(upper) ? [upper] : [];
}

const RAD = Math.PI / 180;
export function distanceKm(a: Pick<Airport, "lat" | "lon">, b: Pick<Airport, "lat" | "lon">): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Business-aviation fields that OurAirports lists with scheduled service but
// that have no airline fares worth searching.
const NOT_FOR_AIRLINES = new Set(["TEB", "VNY", "PDK", "OPF", "FXE", "BCT", "TMB", "APA", "SDL", "MMU", "CCR", "LUK", "DWH", "FTY", "ADS", "BJC", "SGR"]);

/**
 * Commercial airports near any of `codes`, largest then nearest, excluding
 * `codes`. Large airports within `radiusKm`; medium ones only within 80 km,
 * since a small regional airport far away rarely beats the drive.
 */
export function nearbyAirports(codes: string[], radiusKm = 120, limit = 3): (Airport & { km: number })[] {
  const anchors = codes.map(airport).filter((a): a is Airport => Boolean(a));
  if (!anchors.length) return [];
  const taken = new Set(codes);
  return AIRPORTS.filter((a) => a.size >= 2 && !taken.has(a.code) && !NOT_FOR_AIRLINES.has(a.code))
    .map((a) => ({ ...a, km: Math.min(...anchors.map((x) => distanceKm(x, a))) }))
    .filter((a) => a.km <= (a.size >= 3 ? radiusKm : Math.min(radiusKm, 80)))
    .sort((a, b) => b.size - a.size || a.km - b.km)
    .slice(0, limit);
}

export type AirportSuggestion = { code: string; label: string; detail: string; metro: boolean };

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function searchAirports(query: string, limit = 8): AirportSuggestion[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const metros: AirportSuggestion[] = Object.entries(METROS)
    .filter(([code, m]) => code !== "LAX" && (code.toLowerCase() === q || normalize(m.name).startsWith(q)))
    .map(([code, m]) => ({ code, label: m.name, detail: m.codes.join(" · "), metro: true }));

  const scored = AIRPORTS.map((a) => {
    const code = a.code.toLowerCase();
    const city = normalize(a.city);
    const name = normalize(a.name);
    let score = 0;
    if (code === q) score = 100;
    else if (city === q) score = 80;
    else if (city.startsWith(q)) score = 60;
    else if (code.startsWith(q)) score = 50;
    else if (name.includes(q)) score = 30;
    else if (city.includes(q)) score = 20;
    return { a, score: score ? score + a.size * 3 : 0 };
  })
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(({ a }) => ({ code: a.code, label: `${a.city} (${a.code})`, detail: `${a.name} · ${a.country}`, metro: false }));

  return [...metros, ...scored].slice(0, limit);
}

/**
 * Large airports a drive away (beyond the nearby radius, within `maxKm`):
 * candidates for starting the trip somewhere with more and cheaper flights.
 */
export function positioningAirports(codes: string[], minKm = 120, maxKm = 300, limit = 2): (Airport & { km: number })[] {
  const anchors = codes.map(airport).filter((a): a is Airport => Boolean(a));
  if (!anchors.length) return [];
  const taken = new Set(codes);
  return AIRPORTS.filter((a) => a.size >= 3 && !taken.has(a.code) && !NOT_FOR_AIRLINES.has(a.code))
    .map((a) => ({ ...a, km: Math.min(...anchors.map((x) => distanceKm(x, a))) }))
    .filter((a) => a.km > minKm && a.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

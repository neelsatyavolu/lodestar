import { cityForAirport, splitLocal } from "./jsonld";
import { DraftItemSchema, type DraftItem } from "./types";

// One-shot import from Wanderlog. Wanderlog has no public API; its web app
// reads trips with the signed-in `connect.sid` session cookie, and so does
// this, for one request only. The session is never stored or logged.

const BASE = "https://wanderlog.com";
const TIMEOUT_MS = 15_000;
export const MAX_IMPORT = 50;

export class WanderlogError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Accepts the cookie value as copied ("s%3A…"), decoded ("s:…") or as "connect.sid=…". Null when it doesn't look like one. */
export function sessionCookie(raw: string): string | null {
  const value = raw.trim().replace(/^connect\.sid=/, "").replace(/;.*$/, "").trim();
  if (!/^s(%3A|:)[A-Za-z0-9._%+/=-]{20,600}$/.test(value)) return null;
  return `connect.sid=${value.startsWith("s:") ? `s%3A${value.slice(2)}` : value}`;
}

async function get<T>(path: string, cookie: string, fetcher: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(`${BASE}${path}`, {
      headers: { Accept: "application/json", Cookie: cookie, Origin: BASE, Referer: `${BASE}/`, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WanderlogError("Couldn't reach Wanderlog. Try again in a moment.", 502);
  }
  if (res.status === 401 || res.status === 403) throw new WanderlogError("Wanderlog didn't accept that session. Copy a fresh one and try again.", 401);
  if (!res.ok) throw new WanderlogError(`Wanderlog answered with an error (HTTP ${res.status}).`, 502);
  return (await res.json()) as T;
}

type Plan = { key?: string; title?: string; startDate?: string | null; endDate?: string | null; placeCount?: number };
export type WanderlogTrip = { key: string; title: string; startDate: string | null; endDate: string | null; places: number };

const date = (v: unknown) => splitLocal(v)?.date ?? null;

/** The traveller's own trips and ones shared privately with them, newest first. */
export async function listWanderlogTrips(cookie: string, fetcher: typeof fetch = fetch): Promise<WanderlogTrip[]> {
  // A stale or wrong session isn't refused: Wanderlog just answers as a guest. Ask who's signed in first.
  const me = await get<{ user?: { id?: unknown } | null }>("/api/user", cookie, fetcher);
  if (typeof me.user?.id !== "number") throw new WanderlogError("Wanderlog didn't accept that session. Copy a fresh one and try again.", 401);
  const home = await get<{ ownTripPlans?: Plan[]; friendsPrivateSharedTripPlans?: Plan[] }>("/api/tripPlans/home", cookie, fetcher);
  const plans = [...(home.ownTripPlans ?? []), ...(home.friendsPrivateSharedTripPlans ?? [])];
  const seen = new Set<string>();
  return plans
    .filter((p): p is Plan & { key: string } => typeof p.key === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(p.key) && !seen.has(p.key) && Boolean(seen.add(p.key)))
    .map((p) => ({ key: p.key, title: (p.title ?? "Untitled trip").slice(0, 160), startDate: date(p.startDate), endDate: date(p.endDate), places: Number(p.placeCount ?? 0) }))
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
}

export async function getWanderlogTrip(cookie: string, key: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  const env = await get<{ tripPlan?: unknown }>(`/api/tripPlans/${encodeURIComponent(key)}?clientSchemaVersion=2`, cookie, fetcher);
  if (!env.tripPlan) throw new WanderlogError("That Wanderlog trip wasn't found.", 404);
  return env.tripPlan;
}

// ---------- Mapping a Wanderlog trip to Lodestar ----------

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const clock = (v: unknown): string | null => s(v)?.match(/(?:^|T)([01]\d|2[0-3]):([0-5]\d)/)?.slice(1, 3).join(":") ?? null;
const DINING_TYPES = /restaurant|cafe|bar|bakery|food|meal_takeaway/;

function item(raw: Record<string, unknown>): DraftItem | null {
  const r = DraftItemSchema.safeParse(JSON.parse(JSON.stringify(raw)));
  return r.success ? r.data : null;
}

function flightBlock(b: Obj): DraftItem | null {
  const info = o(b.flightInfo);
  const airline = o(info.airline);
  const dep = o(b.depart);
  const arr = o(b.arrive);
  const from = s(o(dep.airport).iata);
  const to = s(o(arr.airport).iata);
  const startDate = date(dep.date);
  if (!startDate) return null;
  const label = [s(airline.iata), s(info.number)].filter(Boolean).join(" ");
  return item({
    kind: "flight",
    status: "booked",
    title: `${label ? `${label} · ` : ""}${from ?? s(o(dep.airport).name) ?? "?"} → ${to ?? s(o(arr.airport).name) ?? "?"}`,
    startDate,
    startTime: clock(dep.time),
    endDate: date(arr.date),
    endTime: clock(arr.time),
    place: (to && cityForAirport(to)) ?? s(o(arr.airport).cityName) ?? null,
    confirmation: s(b.confirmationNumber)?.slice(0, 40) ?? null,
    details: { airline: s(airline.name) ?? s(airline.iata), flightNumber: label || undefined, from, to },
  });
}

function trainBlock(b: Obj): DraftItem | null {
  const dep = o(b.depart);
  const arr = o(b.arrive);
  const startDate = date(dep.date);
  if (!startDate) return null;
  const from = s(o(dep.place).name);
  const to = s(o(arr.place).name);
  return item({
    kind: "transport",
    status: "booked",
    title: `${s(b.carrier) ?? "Train"} · ${from ?? "?"} → ${to ?? "?"}`,
    startDate,
    startTime: clock(dep.time),
    endDate: date(arr.date),
    endTime: clock(arr.time),
    place: to ?? null,
    confirmation: s(b.confirmationNumber)?.slice(0, 40) ?? null,
    details: { provider: s(b.carrier), from, to },
  });
}

function carBlock(b: Obj, city: string | null): DraftItem | null {
  const pick = o(b.pickUp);
  const drop = o(b.dropOff);
  const startDate = date(pick.date);
  if (!startDate) return null;
  const where = o(pick.place);
  return item({
    kind: "transport",
    status: "booked",
    title: `Rental car pickup${s(where.name) ? ` · ${s(where.name)}` : ""}`.slice(0, 160),
    startDate,
    startTime: clock(pick.time),
    endDate: date(drop.date),
    endTime: clock(drop.time),
    place: city,
    confirmation: s(b.confirmationNumber)?.slice(0, 40) ?? null,
    details: { address: s(where.formatted_address)?.slice(0, 240) },
  });
}

function hotelBlock(b: Obj, fallbackCity: string | null): DraftItem | null {
  const hotel = o(b.hotel);
  const place = o(b.place);
  const startDate = date(hotel.checkIn);
  const name = s(place.name);
  if (!startDate || !name) return null;
  const conf = s(hotel.confirmationNumber)?.slice(0, 40);
  return item({
    kind: "stay",
    status: conf ? "booked" : "planned",
    title: name,
    startDate,
    endDate: date(hotel.checkOut),
    place: fallbackCity,
    confirmation: conf ?? null,
    details: { address: s(place.formatted_address)?.slice(0, 240), phone: s(place.international_phone_number)?.slice(0, 40) },
  });
}

function placeBlock(b: Obj, day: string, city: string | null): DraftItem | null {
  const place = o(b.place);
  const name = s(place.name);
  if (!name) return null;
  const types = Array.isArray(place.types) ? place.types.join(" ") : "";
  const rating = Number(place.rating);
  return item({
    kind: DINING_TYPES.test(types) ? "dining" : "activity",
    status: "planned",
    title: name.slice(0, 160),
    startDate: day,
    startTime: clock(b.startTime),
    endDate: null,
    endTime: clock(b.endTime),
    place: city,
    details: { address: s(place.formatted_address)?.slice(0, 240), rating: rating >= 0 && rating <= 5 ? rating : undefined },
  });
}

/** "Trip to Tokyo" → "Tokyo". */
export const destinationFromTitle = (title: string): string | null => title.replace(/^(trip|vacation|holiday|weekend)\s+(to|in)\s+/i, "").trim() || null;

/** A Wanderlog trip as a Lodestar trip and items. Notes and checklists are left out. */
export function mapWanderlogTrip(raw: unknown): { title: string; destination: string | null; startDate: string | null; endDate: string | null; items: DraftItem[] } {
  const plan = o(raw);
  const title = (s(plan.title) ?? "Wanderlog trip").slice(0, 160);
  const destination = destinationFromTitle(title);
  const sections = Array.isArray(o(plan.itinerary).sections) ? (o(plan.itinerary).sections as unknown[]).map(o) : [];
  const items: DraftItem[] = [];
  for (const section of sections) {
    const blocks = Array.isArray(section.blocks) ? section.blocks.map(o) : [];
    const day = section.mode === "dayPlan" ? date(section.date) : null;
    for (const b of blocks) {
      const parsed =
        b.type === "flight" ? flightBlock(b)
        : b.type === "train" ? trainBlock(b)
        : b.type === "rentalCar" ? carBlock(b, destination)
        : b.type === "place" && o(b.hotel).checkIn ? hotelBlock(b, destination)
        : b.type === "place" && day ? placeBlock(b, day, destination)
        : null;
      if (parsed) items.push(parsed);
    }
  }
  return { title, destination, startDate: date(plan.startDate), endDate: date(plan.endDate), items };
}

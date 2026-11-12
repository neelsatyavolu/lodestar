import { z } from "zod";
import type { Endpoint, FlightStatus, Moment, Phase } from "./types";

// Live flight status from AeroDataBox (through RapidAPI's free Basic plan).
// One call per flight number and day, cached by how soon the flight is: the
// free plan's units go to flights about to leave, not ones weeks away.

const HOST = "aerodatabox.p.rapidapi.com";
const TIMEOUT_MS = 8_000;
const HOUR = 3_600_000;

const Time = z.object({ utc: z.string(), local: z.string() }).partial().optional();
const Side = z.object({
  airport: z.object({ iata: z.string().optional(), name: z.string().optional(), municipalityName: z.string().optional(), timeZone: z.string().optional() }).partial().optional(),
  scheduledTime: Time,
  revisedTime: Time,
  predictedTime: Time,
  runwayTime: Time,
  terminal: z.string().optional(),
  gate: z.string().optional(),
  baggageBelt: z.string().optional(),
  quality: z.array(z.string()).optional(),
});
const Flight = z.object({
  departure: Side,
  arrival: Side,
  status: z.string().optional(),
  aircraft: z.object({ model: z.string().optional() }).partial().optional(),
  airline: z.object({ name: z.string().optional() }).partial().optional(),
});
type Side = z.infer<typeof Side>;

const PHASES: Record<string, Phase> = {
  Expected: "scheduled",
  Unknown: "unknown",
  CheckIn: "checkin",
  Boarding: "boarding",
  GateClosed: "boarding",
  Departed: "departed",
  EnRoute: "departed",
  Approaching: "departed",
  Arrived: "landed",
  Delayed: "delayed",
  Canceled: "cancelled",
  CanceledUncertain: "cancelled",
  Diverted: "diverted",
};

/** "2026-11-21 10:20-08:00" + "2026-11-21 18:20Z" → the local date and time and the instant. */
function moment(t: z.infer<typeof Time>): Moment | null {
  const local = t?.local?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  const utc = t?.utc ? Date.parse(t.utc.replace(" ", "T")) : NaN;
  return local && Number.isFinite(utc) ? { date: local[1], time: local[2], utc } : null;
}

/** "PST" for Los Angeles in November, "MST" for Phoenix all year. */
function zoneName(tz: string | undefined, at: number | undefined): string | null {
  if (!tz) return null;
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at ?? Date.now()).find((p) => p.type === "timeZoneName");
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/** A model's predicted time is noise days out; it's worth showing from this close to departure. */
const PREDICT_WITHIN_MS = 12 * HOUR;

function endpoint(s: Side, arrival: boolean, trustPrediction: boolean): Endpoint {
  const scheduled = moment(s.scheduledTime);
  // The runway time is what happened; a revised time from the airline beats a model's prediction.
  const happened = moment(s.runwayTime) ?? (s.revisedTime && s.quality?.includes("Live") ? moment(s.revisedTime) : null);
  const latest = happened ?? moment(s.revisedTime) ?? (trustPrediction ? moment(s.predictedTime) : null);
  return {
    code: s.airport?.iata ?? null,
    name: s.airport?.name ?? null,
    city: s.airport?.municipalityName ?? null,
    zone: zoneName(s.airport?.timeZone, scheduled?.utc),
    terminal: s.terminal ?? null,
    gate: s.gate ?? null,
    baggage: arrival ? (s.baggageBelt ?? null) : null,
    scheduled,
    latest: latest && scheduled && latest.utc === scheduled.utc ? null : latest,
    actual: Boolean(happened),
  };
}

/** Our shape from one AeroDataBox flight; null when it isn't one. */
export function toStatus(raw: unknown, checkedAt: number): FlightStatus | null {
  const f = Flight.safeParse(raw);
  if (!f.success) return null;
  const leaves = moment(f.data.departure.scheduledTime)?.utc;
  const near = leaves !== undefined && leaves - checkedAt < PREDICT_WITHIN_MS;
  const departure = endpoint(f.data.departure, false, near);
  const arrival = endpoint(f.data.arrival, true, near);
  const delay = departure.latest && departure.scheduled ? Math.round((departure.latest.utc - departure.scheduled.utc) / 60_000) : null;
  let phase = PHASES[f.data.status ?? "Unknown"] ?? "unknown";
  // AeroDataBox keeps "Expected" on a flight running late; call it delayed past 15 minutes.
  if ((phase === "scheduled" || phase === "checkin") && delay !== null && delay >= 15) phase = "delayed";
  return { phase, departure, arrival, aircraft: f.data.aircraft?.model ?? null, airline: f.data.airline?.name ?? null, delay, checkedAt };
}

/** How long a status stays fresh: minutes on travel day, hours before it. */
export function freshFor(departsAt: number, now: number): number {
  const until = departsAt - now;
  if (until > 72 * HOUR) return 12 * HOUR;
  if (until > 24 * HOUR) return 3 * HOUR;
  if (until > 4 * HOUR) return 30 * 60_000;
  if (until > -8 * HOUR) return 4 * 60_000;
  return 12 * HOUR;
}

export type Lookup = { airline: string; number: string; date: string; from: string | null; to?: string | null };

const cache = new Map<string, { at: number; until: number; status: FlightStatus | null }>();
const MISS_MS = 30 * 60_000;
/** RapidAPI's free plan takes about one request a second; a 429 waits this long and tries once more. */
const RETRY_AFTER_MS = 1_100;
const MAX_CACHED = 2000;

/** The status of one flight on one day, or null when AeroDataBox doesn't know it. Throws only when the key is refused. */
export async function flightStatus(key: string, q: Lookup, now = Date.now(), fetcher: typeof fetch = fetch, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<FlightStatus | null> {
  const id = `${q.airline}${q.number}/${q.date}/${q.from ?? ""}`;
  const hit = cache.get(id);
  if (hit && now < hit.until) return hit.status;
  const url = `https://${HOST}/flights/number/${q.airline}${q.number}/${q.date}?withAircraftImage=false&withLocation=false`;
  let status: FlightStatus | null = null;
  try {
    const ask = () => fetcher(url, { headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": HOST }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let res = await ask();
    if (res.status === 429) {
      await wait(RETRY_AFTER_MS);
      res = await ask();
    }
    if (res.status === 401 || res.status === 403) throw new Error(`AeroDataBox refused the key (${res.status})`);
    // 204: no such flight that day. Anything else that isn't ok (429 over quota, 5xx) keeps the last answer for now.
    if (res.status !== 204 && !res.ok) return hit?.status ?? null;
    const body: unknown = res.status === 204 ? [] : await res.json();
    const list = Array.isArray(body) ? body : [];
    const flights = list.map((f) => toStatus(f, now)).filter((s): s is FlightStatus => s !== null);
    // A number flies several legs a day: take the trip's own. When the trip names airports and no
    // leg matches them, it's another flight that shares the number, not this one.
    const ours = (s: FlightStatus) => (!q.from || s.departure.code === q.from) && (!q.to || s.arrival.code === q.to);
    status = flights.find(ours) ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("AeroDataBox refused")) throw err;
    return hit?.status ?? null;
  }
  const until = now + (status?.departure.scheduled ? freshFor(status.departure.scheduled.utc, now) : MISS_MS);
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(id, { at: now, until, status });
  return status;
}

/** For tests. */
export const clearFlightCache = () => cache.clear();

import "server-only";
import type { z } from "zod";
import {
  BookingResponseSchema,
  DatesResponseSchema,
  FlightsResponseSchema,
  type BookingPage,
  type Cabin,
  type DayPrice,
  type Itinerary,
  type MaxStops,
} from "./types";

// Typed client for the Python fares service (fares/). Every call has a bounded
// timeout and its response is validated before anything downstream sees it.

const BASE = process.env.FARES_URL ?? "http://127.0.0.1:8787";
const TIMEOUT_MS = { flights: 30_000, dates: 25_000, booking: 45_000 } as const;

export class FaresError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function post<S extends z.ZodType>(path: keyof typeof TIMEOUT_MS, body: unknown, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FARES_TOKEN) headers["x-fares-token"] = process.env.FARES_TOKEN;
  const timeout = AbortSignal.timeout(TIMEOUT_MS[path]);
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new FaresError(timedOut ? "The fare search took too long. Try again." : "The fares service is not reachable. Is it running?", 503);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail : res.status === 422 ? "Some search details are not valid." : "The fare search failed.";
    throw new FaresError(message, res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error(`[fares] ${path} response did not match schema`, parsed.error.issues.slice(0, 3));
    throw new FaresError("Google Flights returned data we could not read.", 502);
  }
  return parsed.data;
}

export type FlightsParams = {
  origins: string[];
  destinations: string[];
  depart: string;
  returnDate?: string | null;
  cabin?: Cabin;
  maxStops?: MaxStops;
  adults?: number;
  children?: number;
  bags?: number;
  expand?: number;
};

export async function searchFlights(p: FlightsParams, signal?: AbortSignal): Promise<Itinerary[]> {
  const res = await post(
    "flights",
    {
      origins: p.origins,
      destinations: p.destinations,
      depart: p.depart,
      return_date: p.returnDate ?? null,
      cabin: p.cabin ?? "ECONOMY",
      max_stops: p.maxStops ?? "ANY",
      passengers: { adults: p.adults ?? 1, children: p.children ?? 0 },
      checked_bags: p.bags ?? 0,
      expand: p.expand ?? 5,
    },
    FlightsResponseSchema,
    signal,
  );
  return res.itineraries;
}

export type DatesParams = Omit<FlightsParams, "depart" | "returnDate" | "bags" | "expand"> & {
  start: string;
  end: string;
  tripDays?: number | null;
};

export async function searchDates(p: DatesParams, signal?: AbortSignal): Promise<DayPrice[]> {
  const res = await post(
    "dates",
    {
      origins: p.origins,
      destinations: p.destinations,
      start: p.start,
      end: p.end,
      trip_days: p.tripDays ?? null,
      cabin: p.cabin ?? "ECONOMY",
      max_stops: p.maxStops ?? "ANY",
      passengers: { adults: p.adults ?? 1, children: p.children ?? 0 },
    },
    DatesResponseSchema,
    signal,
  );
  return res.days;
}

export function bookingPage(tfs: string, signal?: AbortSignal): Promise<BookingPage> {
  return post("booking", { tfs }, BookingResponseSchema, signal);
}

import type { Itinerary, Leg, Slice } from "./types";

// Builders for tests. Not imported by app code.

export function leg(over: Partial<Leg> = {}): Leg {
  return {
    from: "SFO",
    from_name: null,
    to: "JFK",
    to_name: null,
    depart: "2026-12-10T08:00:00",
    arrive: "2026-12-10T16:30:00",
    minutes: 330,
    airline: { code: "AA", name: "American Airlines" },
    operating: null,
    flight_number: "100",
    aircraft: null,
    legroom: null,
    overnight: false,
    amenities: null,
    ...over,
  };
}

export function slice(over: Partial<Slice> = {}): Slice {
  const legs = over.legs ?? [leg()];
  return {
    minutes: legs.reduce((s, l) => s + l.minutes, 0),
    stops: legs.length - 1,
    layovers: [],
    self_transfer: false,
    co2_kg: null,
    co2_delta_pct: null,
    ...over,
    legs,
  };
}

let n = 0;
export function itin(price: number, slices: Slice[] = [slice()], id?: string): Itinerary {
  n += 1;
  return { id: id ?? `it${n}`, price, currency: "USD", slices, booking_url: "https://www.google.com/travel/flights/booking?tfs=abc", tfs: "CBwQAho_EgoyMDI2LTEy" };
}

export function route(from: string, to: string, over: Partial<Leg> = {}): Slice {
  return slice({ legs: [leg({ from, to, ...over })] });
}

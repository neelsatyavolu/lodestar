import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { FlightStatus } from "@/lib/flights/types";
import type { Item } from "@/lib/journeys/types";

// Live status for a trip's flights, asked once when the trip opens and again
// every few minutes while a flight is close (the server caches harder further out).

export type Flights = { live: boolean; byId: Record<string, FlightStatus | null> };

const POLL_MS = 4 * 60_000;
const HOUR = 3_600_000;

/** True while some flight leaves within the next day or is still in the air. */
function soon(items: Item[], now: number): boolean {
  return items.some((i) => {
    if (i.kind !== "flight" || i.status === "cancelled" || i.status === "suggested") return false;
    const at = Date.parse(`${i.startDate}T${i.startTime ?? "12:00"}:00`);
    return at - now < 24 * HOUR && now - at < 12 * HOUR;
  });
}

export function useFlights(tripId: string, items: Item[]): Flights {
  const [state, setState] = useState<Flights>({ live: false, byId: {} });
  const ids = items
    .filter((i) => i.kind === "flight")
    .map((i) => `${i.id}:${i.startDate}:${i.details.flightNumber ?? i.title}`)
    .join("|");
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  }, [items]);

  useEffect(() => {
    if (!ids) return;
    let alive = true;
    const load = () =>
      api<{ live: boolean; flights: Record<string, FlightStatus | null> }>(`/api/journeys/${tripId}/flights`)
        .then((r) => alive && setState({ live: r.live, byId: r.flights }))
        // Status is extra: without it the cards show the booked times.
        .catch(() => {});
    load();
    // Asks again only while a flight is close and the page is in front.
    const timer = setInterval(() => document.visibilityState === "visible" && soon(latest.current, Date.now()) && load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tripId, ids]);

  return state;
}

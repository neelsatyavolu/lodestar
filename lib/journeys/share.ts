import type { Item, TripDetail } from "./types";

// What a read-only share link may show. Confirmation numbers, prices, the
// budget and anything only the AI suggested stay private; everything is
// stripped here, on the server, before the page renders.

const PRIVATE_DETAILS = new Set(["price", "estimate", "currency", "locateFailedAt", "locateFailedWith", "locatedAt"]);

export type SharedTrip = Pick<TripDetail, "title" | "destination" | "startDate" | "endDate" | "travelers" | "tasks" | "notes"> & { items: Item[] };

export function publicTrip(t: TripDetail): SharedTrip {
  const items = t.items
    .filter((i) => i.status !== "suggested")
    .map((i): Item => {
      const details = Object.fromEntries(Object.entries(i.details).filter(([k]) => !PRIVATE_DETAILS.has(k))) as Item["details"];
      return { ...i, confirmation: null, details, dedupeKey: null, source: "manual" };
    });
  return { title: t.title, destination: t.destination, startDate: t.startDate, endDate: t.endDate, travelers: t.travelers, items, tasks: t.tasks, notes: t.notes };
}

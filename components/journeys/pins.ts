import { byItinerary } from "@/lib/journeys/locate";
import type { Item } from "@/lib/journeys/types";

// Pins shared by the map and the itinerary: each day has a colour, each stop
// its number within the day, so "Day 2, stop 3" looks the same in both.

/** Distinct on light and dark maps; `ink` is the number's colour on that fill. */
export const DAY_COLORS = [
  { fill: "#4C8DFF", ink: "#ffffff" },
  { fill: "#F59E0B", ink: "#1a1205" },
  { fill: "#16A34A", ink: "#ffffff" },
  { fill: "#E5484D", ink: "#ffffff" },
  { fill: "#8B5CF6", ink: "#ffffff" },
  { fill: "#06B6D4", ink: "#04191d" },
  { fill: "#EC4899", ink: "#ffffff" },
  { fill: "#84CC16", ink: "#141d04" },
] as const;

export type Pin = { item: Item; n: number; color: (typeof DAY_COLORS)[number] };

export const isPinned = (i: Item) => i.details.lat !== undefined && i.details.lng !== undefined && i.status !== "cancelled";

/** Located items in itinerary order, numbered within their day and coloured by day. */
export function pinsOf(items: Item[]): Pin[] {
  const days = [...new Set(items.map((i) => i.startDate))].sort();
  const perDay = new Map<string, number>();
  return items
    .filter(isPinned)
    .sort(byItinerary)
    .map((item) => {
      const n = (perDay.get(item.startDate) ?? 0) + 1;
      perDay.set(item.startDate, n);
      return { item, n, color: DAY_COLORS[days.indexOf(item.startDate) % DAY_COLORS.length] };
    });
}

/** The colour of a day, for the route line and the day's header. */
export function dayColor(items: Item[], date: string) {
  const days = [...new Set(items.map((i) => i.startDate))].sort();
  return DAY_COLORS[Math.max(0, days.indexOf(date)) % DAY_COLORS.length];
}

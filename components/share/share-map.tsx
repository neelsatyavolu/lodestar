"use client";

import type { Item } from "@/lib/journeys/types";
import { TripMap } from "../journeys/trip-map";

/** The trip map on the share page: every pin, nothing to open. */
export function ShareMap({ items }: { items: Item[] }) {
  return <TripMap items={items} selectedId={null} day={null} onSelect={() => {}} />;
}

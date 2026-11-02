import { addDays } from "../format";
import type { Hotel } from "./types";

// Arriving a night earlier or later, for the same number of nights. Compares
// the same hotels across the three searches using Google's "from" prices, which
// are before taxes, so the saving is an estimate.

export type Shift = "earlier" | "later";
export type FlexSaving = { shift: Shift; checkin: string; checkout: string; saving: number };

/** A saving worth showing: at least $20 and at least 8% of the stay. */
const MIN_SAVING = 20;
const MIN_SHARE = 0.08;

export function shiftedDates(checkin: string, checkout: string, shift: Shift): { checkin: string; checkout: string } {
  const by = shift === "earlier" ? -1 : 1;
  return { checkin: addDays(checkin, by), checkout: addDays(checkout, by) };
}

/** For each hotel, the best saving from moving the stay a night, if any is worth showing. */
export function flexSavings(base: Hotel[], shifted: { shift: Shift; checkin: string; checkout: string; hotels: Hotel[] }[], nights: number): Record<string, FlexSaving> {
  const best: Record<string, FlexSaving> = {};
  for (const run of shifted) {
    const prices = new Map(run.hotels.map((h) => [h.key, h.price]));
    for (const h of base) {
      const other = prices.get(h.key);
      if (other === undefined) continue;
      const saving = Math.round((h.price - other) * nights);
      if (saving < MIN_SAVING || saving < h.price * nights * MIN_SHARE) continue;
      if (!best[h.key] || saving > best[h.key].saving) best[h.key] = { shift: run.shift, checkin: run.checkin, checkout: run.checkout, saving };
    }
  }
  return best;
}

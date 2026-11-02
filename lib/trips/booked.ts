import { z } from "zod";
import type { BookingPage } from "../types";

// A saved trip the traveller has booked: the exact fare they bought, what they
// paid, and the fare's change rules. The daily check reads that same fare from
// the live booking page, so a main cabin booking is never compared with a
// basic economy price.

export const BookingSchema = z.object({
  /** Google's encoding of the exact flights; the booking page is read from it. */
  tfs: z.string().regex(/^[A-Za-z0-9_-]{16,2048}$/, "Invalid itinerary."),
  seller: z.string().trim().min(1).max(80),
  isAirline: z.boolean(),
  fare: z.string().trim().max(80).nullable(),
  paid: z.number().positive().max(1_000_000),
  changes: z.enum(["free", "fee", "none"]).nullable(),
  refunds: z.enum(["full", "partial", "none"]).nullable(),
});
export type Booking = z.infer<typeof BookingSchema>;

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();

/** Today's price of the booked fare from the same seller, or null when it's no longer listed. */
export function bookedFarePrice(page: BookingPage, b: Booking): number | null {
  const seller = page.sellers.find((s) => norm(s.name) === norm(b.seller));
  const fare = seller?.fares.find((f) => norm(f.name) === norm(b.fare));
  return fare?.price ?? null;
}

export type Claim = "yes" | "maybe" | "no" | "unknown";

/** Whether a lower fare can actually come back to the traveller, from the fare's change rules. */
export function creditVerdict(b: Booking): { claim: Claim; text: string } {
  const fare = b.fare ? `The ${b.fare}` : "This";
  const base = ((): { claim: Claim; text: string } => {
    if (b.refunds === "full") return { claim: "yes", text: `${fare} fare is refundable, so you can cancel for a refund and rebook at the lower price.` };
    if (b.changes === "free") return { claim: "yes", text: `${fare} fare has no change fee, so you can usually rebook the same flights at the new price and keep the difference as travel credit.` };
    if (b.changes === "fee") return { claim: "maybe", text: `${fare} fare allows changes for a fee, so rebooking only pays off when the drop is bigger than the fee.` };
    if (b.changes === "none") return { claim: "no", text: `${fare} fare doesn't allow changes, so you can't get the difference back.` };
    const basic = /basic/i.test(b.fare ?? "") ? " Basic fares often can't be changed." : "";
    return { claim: "unknown", text: `Google didn't list the change rules for ${b.fare ? `the ${b.fare}` : "this"} fare.${basic} Check them with ${b.seller} before you rebook.` };
  })();
  if (b.isAirline || base.claim === "no") return base;
  return { ...base, text: `${base.text} You booked through ${b.seller}, so the change goes through them, not the airline.` };
}

import { describe, expect, it } from "vitest";
import type { BookingPage } from "../types";
import { bookedFarePrice, BookingSchema, creditVerdict, type Booking } from "./booked";

const policy = { carry_on: true, checked_bag_fee: null, checked_bag_included: null, changes: null, refunds: null, seat_selection: null };

const page: BookingPage = {
  sellers: [
    {
      name: "United",
      is_airline: true,
      lowest: 380,
      fares: [
        { name: "Basic Economy", price: 380, features: [], policy: { ...policy, changes: "none" } },
        { name: "Economy", price: 440, features: [], policy: { ...policy, changes: "free" } },
      ],
    },
    { name: "Expedia", is_airline: false, lowest: 375, fares: [{ name: null, price: 375, features: [], policy }] },
  ],
  insight: { level: null, typical_low: null, typical_high: null, unlikely_to_drop_below: null, cheaper_than_usual_by: null, summary: null },
  booking_url: "https://www.google.com/travel/flights/booking?tfs=abc",
};

const booking = (over: Partial<Booking> = {}): Booking => BookingSchema.parse({ tfs: "CBwQAhoeEgoyMDI2LTEyLTA3", seller: "United", isAirline: true, fare: "Economy", paid: 480, changes: "free", refunds: "none", ...over });

describe("booked fare price", () => {
  it("reads the same fare from the same seller, not the cheapest one", () => {
    expect(bookedFarePrice(page, booking())).toBe(440);
  });

  it("matches names regardless of case and spacing", () => {
    expect(bookedFarePrice(page, booking({ seller: " united ", fare: "economy" }))).toBe(440);
  });

  it("matches an unnamed fare", () => {
    expect(bookedFarePrice(page, booking({ seller: "Expedia", isAirline: false, fare: null }))).toBe(375);
  });

  it("is null when the seller or fare is no longer listed", () => {
    expect(bookedFarePrice(page, booking({ seller: "Delta" }))).toBeNull();
    expect(bookedFarePrice(page, booking({ fare: "First" }))).toBeNull();
  });
});

describe("credit verdict", () => {
  it("says a refundable fare can be cancelled and rebooked", () => {
    expect(creditVerdict(booking({ refunds: "full", changes: "none" })).claim).toBe("yes");
  });

  it("says a fare with free changes can usually get the difference as credit", () => {
    const v = creditVerdict(booking());
    expect(v).toMatchObject({ claim: "yes" });
    expect(v.text).toContain("travel credit");
  });

  it("says a fare with a change fee only helps when the drop beats the fee", () => {
    expect(creditVerdict(booking({ changes: "fee" })).claim).toBe("maybe");
  });

  it("says a fare without changes can't get money back", () => {
    expect(creditVerdict(booking({ changes: "none" })).claim).toBe("no");
  });

  it("keeps unknown rules unknown, even for a basic fare", () => {
    const v = creditVerdict(booking({ fare: "Basic Economy", changes: null, refunds: null }));
    expect(v.claim).toBe("unknown");
    expect(v.text).toContain("Basic fares often can't be changed");
  });

  it("says when the rules are unknown", () => {
    expect(creditVerdict(booking({ changes: null, refunds: null })).claim).toBe("unknown");
  });

  it("points agency bookings to the agency", () => {
    expect(creditVerdict(booking({ seller: "Expedia", isAirline: false })).text).toContain("through Expedia");
  });
});

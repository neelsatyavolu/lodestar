import { describe, expect, it } from "vitest";
import { flexSavings, shiftedDates } from "./flex";
import { refundable, verifyOffers } from "./offers";
import { nights, StaysSearchSchema, type Hotel, type Offer } from "./types";

const offer = (seller: string, total: number, over: Partial<Offer> = {}): Offer => ({ seller, official: false, nightly_base: total / 3 - 10, nightly: total / 3, total, free_cancel_until: null, url: null, ...over });
const hotel = (key: string, price: number): Hotel => ({ key, name: key, price, deal_pct: null, rating: null, reviews: null, stars: null, amenities: [], image: null });

describe("stay query", () => {
  it("accepts a city and 1 to 30 nights", () => {
    expect(StaysSearchSchema.parse({ city: " São Paulo ", checkin: "2026-12-10", checkout: "2026-12-13" })).toMatchObject({ city: "São Paulo", adults: 2 });
    expect(nights({ checkin: "2026-12-10", checkout: "2026-12-13" })).toBe(3);
  });

  it("rejects an empty stay and markup in the city", () => {
    expect(StaysSearchSchema.safeParse({ city: "Lisbon", checkin: "2026-12-10", checkout: "2026-12-10" }).success).toBe(false);
    expect(StaysSearchSchema.safeParse({ city: "<b>x</b>", checkin: "2026-12-10", checkout: "2026-12-13" }).success).toBe(false);
  });
});

describe("hotel offers", () => {
  it("tiers the hotel's own site as direct and known agencies as trusted", () => {
    const v = verifyOffers([offer("Super.com", 591), offer("Lisbon Marriott Hotel", 643, { official: true }), offer("Hotels.com", 640)]);
    expect(v.map((o) => [o.seller, o.tier])).toEqual([
      ["Super.com", "unvetted"],
      ["Hotels.com", "trusted"],
      ["Lisbon Marriott Hotel", "airline"],
    ]);
    expect(v[1].logo).toContain("hotels.com");
  });

  it("prices a refundable rate against the cheapest one", () => {
    const v = verifyOffers([offer("Hotels.com", 326), offer("Booking.com", 365, { free_cancel_until: "2026-12-04" })]);
    expect(refundable(v, 3)).toMatchObject({ kind: "extra", extra: 39, perNight: 13, offer: { seller: "Booking.com" } });
  });

  it("says when the cheapest rate is already refundable, or none are", () => {
    expect(refundable(verifyOffers([offer("Agoda", 300, { free_cancel_until: "2026-12-04" }), offer("Hotels.com", 320)]), 3).kind).toBe("included");
    expect(refundable(verifyOffers([offer("Hotels.com", 320)]), 3).kind).toBe("none");
  });
});

describe("a night earlier or later", () => {
  it("shifts both dates by a day", () => {
    expect(shiftedDates("2026-12-31", "2027-01-03", "later")).toEqual({ checkin: "2027-01-01", checkout: "2027-01-04" });
    expect(shiftedDates("2026-12-10", "2026-12-13", "earlier")).toEqual({ checkin: "2026-12-09", checkout: "2026-12-12" });
  });

  it("keeps the biggest worthwhile saving per hotel", () => {
    const base = [hotel("a", 100), hotel("b", 100), hotel("c", 100)];
    const savings = flexSavings(
      base,
      [
        { shift: "earlier", checkin: "2026-12-09", checkout: "2026-12-12", hotels: [hotel("a", 80), hotel("b", 98)] },
        { shift: "later", checkin: "2026-12-11", checkout: "2026-12-14", hotels: [hotel("a", 70)] },
      ],
      3,
    );
    expect(savings).toEqual({ a: { shift: "later", checkin: "2026-12-11", checkout: "2026-12-14", saving: 90 } });
  });
});

import { describe, expect, it } from "vitest";
import { sellerAirline } from "./airlines";
import { isValidDomain, sellerDomain, sellerTier } from "./sellers";
import type { BookingPage } from "./types";
import { verify } from "./verify";

const policy = { carry_on: true, checked_bag_fee: null, checked_bag_included: null, changes: null, refunds: null, seat_selection: null };
const fare = (price: number, name: string | null = null) => ({ name, price, features: [], policy });

const page: BookingPage = {
  sellers: [
    { name: "ITA", is_airline: true, lowest: 399, fares: [fare(399, "Economy Light"), fare(519, "Economy Comfort")] },
    { name: "Booking.com", is_airline: false, lowest: 424, fares: [fare(424)] },
    { name: "FlightHub", is_airline: false, lowest: 380, fares: [fare(380)] },
    { name: "Some Agency", is_airline: false, lowest: 410, fares: [fare(410)] },
  ],
  insight: { level: "typical", typical_low: 370, typical_high: 930, unlikely_to_drop_below: null, cheaper_than_usual_by: null, summary: null },
  booking_url: "https://www.google.com/travel/flights/booking?tfs=abc",
};

describe("seller tiers", () => {
  it("classifies sellers", () => {
    expect(sellerTier("ITA", true)).toBe("airline");
    expect(sellerTier("Expedia", false)).toBe("trusted");
    expect(sellerTier("Booking.com", false)).toBe("trusted");
    expect(sellerTier("Justfly.com", false)).toBe("unvetted");
    expect(sellerTier("Brand New OTA", false)).toBe("unvetted");
  });

  it("finds domains for icons", () => {
    expect(sellerDomain("Expedia")).toBe("expedia.com");
    expect(sellerDomain("Justfly.com")).toBe("justfly.com");
    expect(sellerDomain("Some Agency")).toBeNull();
    expect(sellerDomain("newsite.travel")).toBe("newsite.travel");
    expect(isValidDomain("../etc")).toBe(false);
  });

  it("matches airline sellers to itinerary airlines", () => {
    const airlines = [{ code: "AZ", name: "Alitalia" }, { code: "AA", name: "American Airlines" }];
    expect(sellerAirline("ITA", airlines)).toBe("AZ");
    expect(sellerAirline("American", airlines)).toBe("AA");
    expect(sellerAirline("Unknown", [])).toBeNull();
  });
});

describe("verify", () => {
  const v = verify(page, [{ code: "AZ", name: "Alitalia" }]);

  it("finds the cheapest trusted price and the unvetted gap", () => {
    expect(v.lowestAny).toBe(380);
    expect(v.lowestTrusted).toBe(399);
    expect(v.trustedSeller).toBe("ITA");
    expect(v.unvettedGap).toBe(19);
  });

  it("gives every seller a logo url", () => {
    const logos = Object.fromEntries(v.sellers.map((s) => [s.name, s.logo]));
    expect(logos.ITA).toBe("/api/logo/airline/AZ");
    expect(logos["Booking.com"]).toContain("/api/logo/site/booking.com");
    expect(logos["Some Agency"]).toContain("/api/logo/site/_?name=Some%20Agency");
  });

  it("sorts sellers by price", () => {
    expect(v.sellers.map((s) => s.lowest)).toEqual([380, 399, 410, 424]);
  });

  it("ignores fares from another cabin when the searched price is known", () => {
    const business: BookingPage = {
      ...page,
      sellers: [{ name: "American", is_airline: true, lowest: 359, fares: [fare(359, "Main Select"), fare(824, "First")] }],
    };
    const v = verify(business, [{ code: "AA", name: "American Airlines" }], 824);
    expect(v.lowestTrusted).toBe(824);
    expect(v.sellers[0].fares.map((f) => f.name)).toEqual(["First"]);
    expect(verify(business, [], undefined).lowestTrusted).toBe(359);
  });

  it("handles a page with only unvetted sellers", () => {
    const only = verify({ ...page, sellers: [page.sellers[2]] }, []);
    expect(only.lowestTrusted).toBeNull();
    expect(only.unvettedGap).toBe(0);
  });
});

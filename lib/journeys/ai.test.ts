import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../preferences";
import type { Hotel } from "../stays/types";
import { describeTastes, describeTrip, diningUserPrompt, hotelUserPrompt, parseDining, parseHotelPicks, parseReadItems, readUserPrompt, tripDays } from "./ai";
import type { JourneyWithItems } from "./types";

const trip: JourneyWithItems = {
  id: "j",
  title: "Lisbon, May 2027",
  destination: "Lisbon",
  startDate: "2027-05-01",
  endDate: "2027-05-03",
  source: "manual",
  createdAt: 0,
  items: [
    { id: "i1", journeyId: "j", kind: "stay", status: "booked", title: "Memmo Alfama", startDate: "2027-05-01", startTime: null, endDate: "2027-05-03", endTime: null, place: "Lisbon", confirmation: null, details: { address: "Alfama" }, source: "email", dedupeKey: null, updatedAt: 0 },
    { id: "i2", journeyId: "j", kind: "dining", status: "suggested", title: "Old idea", startDate: "2027-05-01", startTime: null, endDate: null, endTime: null, place: null, confirmation: null, details: {}, source: "ai", dedupeKey: null, updatedAt: 0 },
  ],
};

const hotel = (name: string): Hotel => ({ key: `key_${name.replace(/\W/g, "")}_0000`, name, price: 180, deal_pct: null, rating: 4.6, reviews: 900, stars: 4, amenities: ["Pool"], image: null });

describe("reading an email", () => {
  it("keeps valid bookings, drops stray fields and refuses guesses it can't validate", () => {
    const text = `Here you go:\n\`\`\`json\n${JSON.stringify({
      items: [
        { kind: "dining", status: "booked", title: "Nopa", startDate: "2027-06-04", startTime: "19:00", place: "San Francisco", confirmation: "", details: { guests: 2, sneaky: "x" } },
        { kind: "stay", status: "booked", title: "Hotel", startDate: "June 4" },
        { kind: "flight", status: "suggested", title: "UA 1", startDate: "2027-06-04" },
        { kind: "activity", status: "booked", title: "Alcatraz", startDate: "2027-06-05", details: { price: "about $45" } },
      ],
    })}\n\`\`\``;
    const items = parseReadItems(text);
    expect(items.map((i) => i.title)).toEqual(["Nopa", "Alcatraz"]);
    expect(items[0]).toMatchObject({ confirmation: null, details: { guests: 2 } });
    expect(items[1].details).toEqual({});
    expect(parseReadItems('{"items": []}')).toEqual([]);
    expect(() => parseReadItems("no json")).toThrow();
  });

  it("dates the email for year inference and fences it as data", () => {
    expect(readUserPrompt({ body: "hi", receivedAt: Date.parse("2027-01-02T00:00:00Z") })).toBe("The email was received on 2027-01-02.\n\n<email>\nhi\n</email>");
  });
});

describe("trip context", () => {
  it("lists the trip's days and its real plans, not suggestions", () => {
    expect(tripDays(trip)).toEqual(["2027-05-01", "2027-05-02", "2027-05-03"]);
    expect(tripDays({ startDate: null, endDate: null })).toEqual([]);
    expect(tripDays({ startDate: "2027-01-01", endDate: "2027-03-01" })).toHaveLength(21);
    const described = describeTrip(trip);
    expect(described).toContain("stay · Memmo Alfama (Lisbon), Alfama");
    expect(described).not.toContain("Old idea");
  });

  it("puts preferences into words", () => {
    expect(describeTastes(DEFAULT_PREFERENCES)).toBe("pace: balanced");
    const tastes = describeTastes({ ...DEFAULT_PREFERENCES, cuisines: ["Seafood"], dietary: ["Vegetarian"], diningBudget: "$$", interests: ["Museums"], hotelBudget: 200, hotelPriorities: ["Quiet"] });
    expect(tastes).toBe("cuisines they love: Seafood; dietary needs: Vegetarian; usual dinner budget: $$; interests: Museums; pace: balanced; hotel budget about $200 a night; in a hotel they care about: Quiet");
    expect(diningUserPrompt(trip, tastes)).toContain("Days to plan: 2027-05-01, 2027-05-02, 2027-05-03");
  });
});

describe("dining plan", () => {
  it("keeps suggestions on the trip's days, once each, with a maps link", () => {
    const text = JSON.stringify({
      items: [
        { title: "Cervejaria Ramiro", startDate: "2027-05-01", startTime: "20:00", details: { meal: "dinner", cuisine: "Seafood", priceLevel: "$$", why: "Seafood, as you like" } },
        { title: "cervejaria ramiro", startDate: "2027-05-02", startTime: "20:00" },
        { title: "Somewhere", startDate: "2027-06-01", startTime: "13:00" },
        { title: "Time Out Market", startDate: "2027-05-02", startTime: "13:00", status: "booked", confirmation: "X" },
      ],
    });
    const items = parseDining(text, trip);
    expect(items.map((i) => i.title)).toEqual(["Cervejaria Ramiro", "Time Out Market"]);
    expect(items.every((i) => i.kind === "dining" && i.status === "suggested" && i.confirmation === null && i.place === "Lisbon")).toBe(true);
    expect(items[0].details.url).toBe("https://www.google.com/maps/search/?api=1&query=Cervejaria%20Ramiro%20Lisbon");
  });
});

describe("hotel picks", () => {
  const hotels = [hotel("Memmo Alfama"), hotel("Bairro Alto Hotel"), hotel("The Lumiares")];

  it("only picks hotels from the live list, once each, up to three", () => {
    const picks = parseHotelPicks(JSON.stringify({ picks: [{ n: 2, why: "Quiet rooms" }, { n: 2, why: "again" }, { n: 9, why: "made up" }, { n: "1" }] }), hotels);
    expect(picks.map((p) => [p.hotel.name, p.why])).toEqual([["Bairro Alto Hotel", "Quiet rooms"], ["Memmo Alfama", ""]]);
    expect(parseHotelPicks('{"picks": "none"}', hotels)).toEqual([]);
  });

  it("numbers the live results for the model", () => {
    expect(hotelUserPrompt(trip, "", hotels)).toContain("1. Memmo Alfama · from $180/night · 4★ class · rated 4.6/5 (900 reviews) · Pool");
  });
});

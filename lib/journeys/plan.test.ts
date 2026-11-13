import { describe, expect, it } from "vitest";
import { bookings, budget, daySummary, isPacking, issues, nights, starterTasks, toBook } from "./plan";
import type { Cost, Item, TripDetail } from "./types";

const item = (over: Partial<Item>): Item => ({
  id: over.title ?? "i",
  journeyId: "j",
  kind: "activity",
  status: "planned",
  title: "Walk",
  startDate: "2026-11-22",
  startTime: null,
  endDate: null,
  endTime: null,
  place: null,
  confirmation: null,
  details: {},
  source: "manual",
  dedupeKey: null,
  updatedAt: 0,
  ...over,
});

const cost = (over: Partial<Cost>): Cost => ({ id: "c", journeyId: "j", label: "Gas", amount: 100, currency: "USD", category: "transport", paid: false, source: "manual", ...over });

const trip = (items: Item[], over: Partial<TripDetail> = {}): TripDetail => ({
  id: "j",
  title: "Dove Mountain",
  destination: "Tucson",
  startDate: "2026-11-21",
  endDate: "2026-11-26",
  travelers: 4,
  tripType: "family",
  shareToken: null,
  source: "manual",
  createdAt: 0,
  items,
  tasks: [],
  notes: [],
  costs: [],
  ...over,
});

const ritz = item({ kind: "stay", status: "booked", title: "Ritz-Carlton", startDate: "2026-11-21", endDate: "2026-11-26", details: { price: 6907 } });

describe("to book", () => {
  it("lists planned things that need reserving, earliest deadline first", () => {
    const spa = item({ title: "Spa", startDate: "2026-11-24", details: { reserve: true, bookBy: "2026-11-15" } });
    const hike = item({ title: "Hike", startDate: "2026-11-22", details: { reserve: true } });
    const walk = item({ title: "Walk", details: {} });
    const booked = item({ title: "Dinner", status: "booked", details: { reserve: true } });
    expect(toBook([hike, walk, spa, booked]).map((i) => i.title)).toEqual(["Spa", "Hike"]);
  });
});

describe("bookings", () => {
  it("groups booked and cancelled reservations by kind, flights first", () => {
    const flight = item({ kind: "flight", status: "booked", title: "WN 4623" });
    const dinner = item({ kind: "dining", status: "cancelled", title: "Penca" });
    const idea = item({ kind: "dining", status: "suggested", title: "Idea" });
    expect(bookings([dinner, ritz, flight, idea]).map((g) => [g.kind, g.items.map((i) => i.title)])).toEqual([
      ["flight", ["WN 4623"]],
      ["stay", ["Ritz-Carlton"]],
      ["dining", ["Penca"]],
    ]);
  });
});

describe("budget", () => {
  it("adds paid bookings, estimates and extra lines by category, per person", () => {
    const spa = item({ title: "Spa", details: { estimate: 600 } });
    const idea = item({ title: "Idea", status: "suggested", details: { estimate: 999 } });
    const b = budget(trip([ritz, spa, idea], { costs: [cost({ amount: 350 }), cost({ label: "Resort fee", amount: 687, category: "stays", paid: true })] }));
    expect(b.lines).toEqual([
      { category: "stays", paid: 7594, estimated: 0 },
      { category: "transport", paid: 0, estimated: 350 },
      { category: "activities", paid: 0, estimated: 600 },
    ]);
    expect(b).toMatchObject({ currency: "USD", paid: 7594, estimated: 950, total: 8544, perPerson: 2136, otherCurrencies: [] });
  });

  it("sums the most common currency and names the others", () => {
    const b = budget(trip([item({ title: "Museum", status: "booked", details: { price: 20, currency: "EUR" } })], { costs: [cost({ currency: "EUR", amount: 30 }), cost({ amount: 5 })] }));
    expect(b).toMatchObject({ currency: "EUR", total: 50, otherCurrencies: ["USD"] });
  });
});

describe("nights", () => {
  it("groups nights at the same stay and shows nights with none", () => {
    const short = item({ kind: "stay", status: "booked", title: "Inn", startDate: "2026-11-21", endDate: "2026-11-23" });
    expect(nights(trip([short])).map((r) => [r.from, r.to, r.nights, r.stay?.title ?? null])).toEqual([
      ["2026-11-21", "2026-11-23", 2, "Inn"],
      ["2026-11-23", "2026-11-26", 3, null],
    ]);
  });

  it("is empty for a day trip or a trip without dates", () => {
    expect(nights(trip([], { endDate: "2026-11-21" }))).toEqual([]);
    expect(nights(trip([], { startDate: null, endDate: null }))).toEqual([]);
  });
});

describe("issues", () => {
  const today = "2026-11-10";

  it("flags missing stays, overdue and soon bookings, and clashes", () => {
    const short = item({ kind: "stay", status: "booked", title: "Inn", startDate: "2026-11-21", endDate: "2026-11-25" });
    const late = item({ title: "Spa", startDate: "2026-11-24", details: { reserve: true, bookBy: "2026-11-08" } });
    const soon = item({ title: "Cabana", startDate: "2026-11-22", details: { reserve: true, bookBy: "2026-11-15" } });
    const a = item({ title: "Penca", kind: "dining", status: "booked", startDate: "2026-11-21", startTime: "19:00" });
    const b = item({ title: "Show", startDate: "2026-11-21", startTime: "19:00" });
    const found = issues(trip([short, late, soon, a, b]), today).map((i) => i.text);
    expect(found).toEqual([
      "No place to stay for the night of Nov 25.",
      "Spa was to be booked by Nov 8.",
      "Book Cabana by Nov 15.",
      "Penca and Show are both at 19:00 on Nov 21.",
      "Nothing planned yet on Nov 23, Nov 25, Nov 26.",
    ]);
  });

  it("says nothing about a trip that's over", () => {
    expect(issues(trip([]), "2026-12-01")).toEqual([]);
  });
});

describe("starter checklist", () => {
  it("adds trip-type extras to the basics", () => {
    const titles = starterTasks("ski").map((t) => t.title);
    expect(titles).toContain("Book lift tickets and rentals");
    expect(starterTasks(null).length).toBeLessThan(titles.length);
  });
});

describe("packing", () => {
  it("is the Packing section, however it's typed", () => {
    expect(isPacking({ section: "Packing" })).toBe(true);
    expect(isPacking({ section: " packing " })).toBe(true);
    expect(isPacking({ section: "Before you go" })).toBe(false);
    expect(starterTasks("ski").filter(isPacking).map((t) => t.title)).toEqual(["Layers, goggles and gloves", "Chargers, medications and documents"]);
  });
});

describe("day summary", () => {
  it("names the day's plans in order, with flights as arriving or leaving", () => {
    const fly = item({ kind: "flight", status: "booked", title: "WN 4623", startDate: "2026-11-21", startTime: "10:20" });
    const lunch = item({ kind: "dining", title: "Pizzeria Bianco", startDate: "2026-11-21", startTime: "14:00" });
    const dinner = item({ kind: "dining", title: "Penca", startDate: "2026-11-21", startTime: "19:00" });
    const idea = item({ title: "Idea", status: "suggested", startDate: "2026-11-21" });
    const home = item({ kind: "flight", status: "booked", title: "WN 504", startDate: "2026-11-26", details: { to: "SFO" } });
    const t = trip([dinner, idea, ritz, lunch, fly, home]);
    expect(daySummary(t, "2026-11-21")).toBe("Fly in, Pizzeria Bianco, Penca");
    expect(daySummary(t, "2026-11-26")).toBe("Fly home");
    expect(daySummary(t, "2026-11-23")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { PART_PROMPTS, parseBudget, parseChecklist, parseItinerary, parseNotes, parseToBook, type PlanContext } from "./generate";
import type { Item, TripDetail } from "./types";

const item = (over: Partial<Item>): Item => ({
  id: "i",
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

const hike = item({ id: "hike", title: "Rock Art hike", startDate: "2026-11-25" });
const spa = item({ id: "spa", title: "Spa", startDate: "2026-11-24", details: { estimate: 500 } });
const ritz = item({ id: "ritz", kind: "stay", status: "booked", title: "Ritz-Carlton", startDate: "2026-11-21", endDate: "2026-11-24" });

const trip: TripDetail = {
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
  items: [hike, spa, ritz],
  tasks: [{ id: "t", journeyId: "j", title: "Pack sunscreen", done: false, due: null, section: "Packing", position: 0, source: "manual" }],
  notes: [],
  costs: [],
};
const c: PlanContext = { trip, tastes: "dietary needs: Vegetarian", wishes: "a slow week", today: "2026-11-10" };
const json = (v: unknown) => `Here you go:\n${JSON.stringify(v)}`;

describe("drafting the itinerary", () => {
  it("keeps planned things inside the trip, drops repeats, bad kinds and stale deadlines", () => {
    const items = parseItinerary(
      json({
        items: [
          { kind: "activity", title: "Sabino Canyon tram", startDate: "2026-11-23", startTime: "09:00", place: "Tucson", details: { note: "Go early.", reserve: true, bookBy: "2026-11-20", estimate: "62.5" } },
          { kind: "dining", title: "Penca", startDate: "2026-11-23", startTime: "19:00", details: { reserve: true, bookBy: "2026-11-01" } },
          { kind: "activity", title: "rock art hike", startDate: "2026-11-25" },
          { kind: "activity", title: "Too late", startDate: "2026-11-30" },
          { kind: "flight", title: "Not mine", startDate: "2026-11-23" },
          { kind: "dining", title: "Late deadline", startDate: "2026-11-22", details: { reserve: true, bookBy: "2026-11-23" } },
          "junk",
        ],
      }),
      c,
    );
    expect(items.map((i) => i.title)).toEqual(["Sabino Canyon tram", "Penca", "Late deadline"]);
    expect(items[0]).toMatchObject({ status: "planned", startTime: "09:00", details: { note: "Go early.", reserve: true, bookBy: "2026-11-20", estimate: 63 } });
    expect(items[1].details).toEqual({ reserve: true });
    expect(items[2].details.bookBy).toBeUndefined();
  });

  it("returns nothing for an answer that isn't JSON", () => {
    expect(parseItinerary("Sorry, I can't help with that.", c)).toEqual([]);
  });
});

describe("working out what to book", () => {
  it("flags only planned items it was shown and adds missing essentials with deadlines", () => {
    const plan = parseToBook(
      json({
        flag: [{ id: "hike", bookBy: "2026-11-20" }, { id: "ritz" }, { id: "made-up" }, { id: "spa", bookBy: "2026-12-01" }, { id: "hike" }],
        add: [
          { kind: "stay", title: "Hotel for Nov 24 to 26", startDate: "2026-11-24", endDate: "2026-11-26", place: "Tucson", details: { bookBy: "2026-11-15", estimate: 900, note: "Near the airport." } },
          { kind: "stay", title: "Backwards", startDate: "2026-11-24", endDate: "2026-11-22" },
          { kind: "flight", title: "Extra flight", startDate: "2026-11-24" },
        ],
      }),
      c,
    );
    expect(plan.flags).toEqual([
      { id: "hike", bookBy: "2026-11-20" },
      { id: "spa", bookBy: null },
    ]);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]).toMatchObject({ kind: "stay", status: "planned", endDate: "2026-11-26", details: { reserve: true, bookBy: "2026-11-15", estimate: 900, note: "Near the airport." } });
  });

  it("tells the model which nights have no stay", () => {
    expect(PART_PROMPTS.to_book.user(c)).toContain("Nights without a place to stay: 2026-11-24 to 2026-11-26");
    expect(PART_PROMPTS.to_book.user(c)).toContain("id hike:");
  });
});

describe("the checklist", () => {
  it("skips tasks already on the list, normalises sections and keeps only future due dates", () => {
    const tasks = parseChecklist(
      json({
        tasks: [
          { title: "pack sunscreen", section: "Packing" },
          { title: "Confirm the spa times", section: "bookings", due: "2026-11-15" },
          { title: "Old task", section: "Elsewhere", due: "2026-10-01" },
          { title: "  " },
        ],
      }),
      c,
    );
    expect(tasks).toEqual([
      { title: "Confirm the spa times", section: "Bookings", due: "2026-11-15" },
      { title: "Old task", section: "Before you go", due: null },
    ]);
  });
});

describe("notes", () => {
  it("keeps titled notes with bodies", () => {
    expect(parseNotes(json({ notes: [{ title: "Getting around", body: "- Drive; the resort is 45 min from town." }, { title: "Empty", body: "" }] }))).toEqual([{ title: "Getting around", body: "- Drive; the resort is 45 min from town." }]);
  });
});

describe("the budget", () => {
  it("estimates only planned items without a cost, once, and keeps sane extra lines", () => {
    const plan = parseBudget(
      json({
        estimates: [{ id: "hike", amount: 40.4 }, { id: "hike", amount: 99 }, { id: "spa", amount: 700 }, { id: "ritz", amount: 1 }],
        costs: [{ label: "Gas, about 500 miles", amount: 120, category: "transport" }, { label: "Tips", amount: 80, category: "gratuity" }, { label: "Free", amount: 0 }],
      }),
      c,
    );
    expect(plan.estimates).toEqual([{ id: "hike", amount: 40 }]);
    expect(plan.costs).toEqual([
      { label: "Gas, about 500 miles", amount: 120, category: "transport" },
      { label: "Tips", amount: 80, category: "other" },
    ]);
  });
});

describe("prompts", () => {
  it("give the model the trip, who's going, today and what they asked for", () => {
    const text = PART_PROMPTS.itinerary.user(c);
    for (const bit of ["Destination: Tucson", "a family trip; 4 travellers", "Today is 2026-11-10", "dietary needs: Vegetarian", "a slow week", "Days to plan: 2026-11-21"]) expect(text).toContain(bit);
  });
});

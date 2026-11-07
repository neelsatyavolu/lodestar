import { describe, expect, it } from "vitest";
import { publicTrip } from "./share";
import type { Item, TripDetail } from "./types";

const item = (over: Partial<Item>): Item => ({
  id: "i",
  journeyId: "j",
  kind: "stay",
  status: "booked",
  title: "Ritz-Carlton",
  startDate: "2026-11-21",
  startTime: null,
  endDate: "2026-11-26",
  endTime: null,
  place: "Marana",
  confirmation: "RC777123",
  details: { price: 6907, currency: "USD", estimate: 7000, address: "15000 N Secret Springs Dr", lat: 32.4, lng: -111.1, locatedAt: 5 },
  source: "email",
  dedupeKey: "stay:rc777",
  updatedAt: 0,
  ...over,
});

const trip: TripDetail = {
  id: "j",
  title: "Thanksgiving",
  destination: "Tucson",
  startDate: "2026-11-21",
  endDate: "2026-11-26",
  travelers: 4,
  tripType: "family",
  shareToken: "secret",
  source: "manual",
  createdAt: 0,
  items: [item({}), item({ id: "idea", status: "suggested", title: "Some idea" })],
  tasks: [],
  notes: [{ id: "n", journeyId: "j", title: "How the week works", body: "Rest first.", position: 0, source: "manual" }],
  costs: [{ id: "c", journeyId: "j", label: "Resort fee", amount: 687, currency: "USD", category: "stays", paid: false, source: "manual" }],
};

describe("a shared trip", () => {
  it("hides confirmation numbers, prices, the budget, the share token and AI ideas", () => {
    const shared = publicTrip(trip);
    const text = JSON.stringify(shared);
    for (const secret of ["RC777123", "6907", "7000", "687", "secret", "Some idea", "stay:rc777"]) expect(text).not.toContain(secret);
    expect(shared).not.toHaveProperty("costs");
    expect(shared.items).toHaveLength(1);
    expect(shared.items[0].details).toEqual({ address: "15000 N Secret Springs Dr", lat: 32.4, lng: -111.1 });
    expect(shared.notes[0].body).toBe("Rest first.");
  });
});

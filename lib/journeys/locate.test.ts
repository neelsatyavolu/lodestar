import { describe, expect, it } from "vitest";
import { byItinerary, dayStops } from "./locate";
import type { Item } from "./types";

const item = (id: string, over: Partial<Item>): Item => ({
  id, journeyId: "t", source: "agent", dedupeKey: null, updatedAt: 0,
  kind: "activity", status: "planned", title: id, startDate: "2026-11-22", startTime: null, endDate: null, endTime: null, place: null, confirmation: null, details: {},
  ...over,
});

const at = { lat: 32.2, lng: -110.9 };
const spa = item("spa", { startTime: "15:00", endTime: "17:00", details: at });
const drive = item("drive", { kind: "note", title: "Drive downtown", startTime: "17:15" });
const dinner = item("dinner", { kind: "dining", startTime: "18:00", details: { lat: 32.21, lng: -110.97 } });

describe("a day note between two stops", () => {
  it("sits between them by its time", () => {
    expect([dinner, drive, spa].sort(byItinerary).map((i) => i.id)).toEqual(["spa", "drive", "dinner"]);
  });

  it("follows a stop that shares its time", () => {
    const leave = item("leave", { kind: "note", startTime: "18:00" });
    expect([leave, dinner].sort(byItinerary).map((i) => i.id)).toEqual(["dinner", "leave"]);
  });

  it("isn't a stop, so the drive goes straight from one stop to the next", () => {
    expect(dayStops([dinner, drive, spa], "2026-11-22").map((i) => i.id)).toEqual(["spa", "dinner"]);
  });
});

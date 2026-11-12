import { describe, expect, it } from "vitest";
import { flightAirports, flightBetween, flightCode, flightGroups, foldedIds } from "./flights";
import type { Item } from "./types";

const item = (over: Partial<Item>): Item => ({
  id: over.title ?? "i",
  journeyId: "j",
  kind: "activity",
  status: "planned",
  title: "Walk",
  startDate: "2026-11-21",
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

// The day from the screenshot: an airport stop, the flight, a landing stop and the rental car.
const flight = item({ kind: "flight", status: "booked", title: "Southwest WN 4623 · SFO → PHX · nonstop 2h05 · 4 travelers", startTime: "10:20", endTime: "13:25", details: { airline: "Southwest" } });
const sfo = item({ title: "SFO Terminal 1", startTime: "08:50", details: { address: "San Francisco International Airport, Terminal 1" } });
const phx = item({ title: "Land at PHX Terminal 4", startTime: "13:25", details: { note: "Rental Car Center shuttle from the curb, ~15 min" } });
const alamo = item({ kind: "transport", title: "Alamo rental", startTime: "14:00", details: { address: "1805 E Sky Harbor Cir S, Phoenix, AZ" } });

describe("flightCode", () => {
  it("reads the number from details first", () => {
    expect(flightCode(item({ title: "Flight home", details: { flightNumber: "UA 837" } }))).toEqual({ airline: "UA", number: "837" });
  });
  it("falls back to the title", () => {
    expect(flightCode(flight)).toEqual({ airline: "WN", number: "4623" });
    expect(flightCode(item({ title: "B6123 to Boston" }))).toEqual({ airline: "B6", number: "123" });
  });
  it("is null without a flight number", () => {
    expect(flightCode(item({ title: "Fly to Phoenix" }))).toBeNull();
  });
});

describe("flightAirports", () => {
  it("prefers details, then the title's A → B", () => {
    expect(flightAirports(item({ title: "x", details: { from: "SFO", to: "PHX" } }))).toEqual({ from: "SFO", to: "PHX" });
    expect(flightAirports(flight)).toEqual({ from: "SFO", to: "PHX" });
    expect(flightAirports(item({ title: "San Francisco (SFO) to Tokyo", details: { from: "San Francisco (SFO)" } }))).toEqual({ from: "SFO", to: null });
  });
});

describe("flightGroups", () => {
  it("folds the airport stops on either side of the flight into it", () => {
    const groups = flightGroups([sfo, flight, phx, alamo]);
    expect(groups).toEqual([{ flight, departure: sfo, arrival: phx }]);
    expect([...foldedIds(groups)]).toEqual([sfo.id, phx.id]);
  });
  it("leaves stops outside the time window or at other airports alone", () => {
    const early = { ...sfo, id: "early", startTime: "05:00" };
    const other = item({ title: "OAK Terminal 2", startTime: "09:00" });
    const late = { ...phx, id: "late", startTime: "17:00" };
    expect(flightGroups([early, other, flight, late])).toEqual([{ flight, departure: null, arrival: null }]);
  });
  it("needs the airport in the title, or an airport word plus the code in the address", () => {
    const parking = item({ title: "Terminal 4 parking", startTime: "13:40", details: { address: "Sky Harbor, PHX" } });
    expect(flightGroups([flight, parking])[0].arrival).toBe(parking);
    expect(flightGroups([flight, alamo])[0].arrival).toBeNull();
  });
  it("ignores cancelled and suggested flights and stops", () => {
    expect(flightGroups([{ ...flight, status: "cancelled" }, sfo])).toEqual([]);
    expect(flightGroups([flight, { ...sfo, status: "suggested" }])[0].departure).toBeNull();
  });
  it("puts an overnight arrival on the landing day", () => {
    const redeye = item({ kind: "flight", title: "UA 1 SFO → JFK", startTime: "22:00", endDate: "2026-11-22", endTime: "06:30" });
    const jfk = item({ title: "JFK Terminal 7", startDate: "2026-11-22", startTime: "07:00" });
    expect(flightGroups([redeye, jfk])[0].arrival).toBe(jfk);
  });
});

describe("flightBetween", () => {
  it("is true when a flight leaves between two stops", () => {
    expect(flightBetween([sfo, flight, phx], "2026-11-21", sfo, phx)).toBe(true);
    expect(flightBetween([sfo, flight, phx, alamo], "2026-11-21", phx, alamo)).toBe(false);
  });
});

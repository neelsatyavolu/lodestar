import { describe, expect, it } from "vitest";
import type { FlightStatus } from "../flights/types";
import { bookedMinutes, duration, flightView } from "./flight-view";
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

const flight = item({ kind: "flight", status: "booked", title: "Southwest WN 4623 · SFO → PHX · nonstop 2h05 · 4 travelers", startTime: "10:20", endTime: "13:25", details: { airline: "Southwest" } });
const sfo = item({ title: "SFO Terminal 1", startTime: "08:50" });
const phx = item({ title: "Land at PHX Terminal 4", startTime: "13:25", details: { note: "Rental Car Center shuttle from the curb, ~15 min" } });

const at = (date: string, time: string, utc: string) => ({ date, time, utc: Date.parse(utc) });
const status = (over: Partial<FlightStatus> = {}): FlightStatus => ({
  phase: "scheduled",
  departure: { code: "SFO", name: "San Francisco", city: "San Francisco", zone: "PST", terminal: "2", gate: null, baggage: null, scheduled: at("2026-11-21", "10:20", "2026-11-21T18:20Z"), latest: null, actual: false },
  arrival: { code: "PHX", name: "Phoenix Sky Harbor", city: "Phoenix", zone: "MST", terminal: "4", gate: null, baggage: null, scheduled: at("2026-11-21", "13:25", "2026-11-21T20:25Z"), latest: null, actual: false },
  aircraft: "Boeing 737-800",
  airline: "Southwest Airlines",
  delay: null,
  checkedAt: 0,
  ...over,
});

describe("flightView", () => {
  it("shows the booking alone when there's no live status", () => {
    const v = flightView({ flight, departure: sfo, arrival: phx }, null);
    expect(v).toMatchObject({ label: "WN 4623", airlineName: "Southwest", status: "Booked", tone: "idle", minutes: 125, live: false });
    expect(v.from).toMatchObject({ code: "SFO", time: "10:20", terminal: "1", beThere: "08:50", zone: null });
    expect(v.to).toMatchObject({ code: "PHX", time: "13:25", terminal: "4", note: "Rental Car Center shuttle from the curb, ~15 min" });
  });

  it("prefers live terminals, zones and the schedule's duration", () => {
    const v = flightView({ flight, departure: sfo, arrival: phx }, status());
    expect(v).toMatchObject({ status: "On time", tone: "ok", minutes: 125, aircraft: "Boeing 737-800" });
    expect(v.from).toMatchObject({ terminal: "2", zone: "PST", city: "San Francisco", name: "San Francisco" });
    expect(v.shift).toBe(60);
  });

  it("strikes the booked time through when the flight runs late", () => {
    const late = status({ phase: "delayed", delay: 45, departure: { ...status().departure, latest: at("2026-11-21", "11:05", "2026-11-21T19:05Z") } });
    const v = flightView({ flight, departure: null, arrival: null }, late);
    expect(v).toMatchObject({ status: "Delayed 45 min", tone: "warn" });
    expect(v.from).toMatchObject({ time: "11:05", was: "10:20" });
  });

  it("moves the plane along while in the air", () => {
    const now = Date.parse("2026-11-21T19:22:30Z");
    expect(flightView({ flight, departure: null, arrival: null }, status({ phase: "departed" }), now).progress).toBeCloseTo(0.5, 2);
    expect(flightView({ flight, departure: null, arrival: null }, status({ phase: "landed" })).progress).toBe(1);
  });

  it("says cancelled when the booking is", () => {
    expect(flightView({ flight: { ...flight, status: "cancelled" }, departure: null, arrival: null }, status())).toMatchObject({ status: "Cancelled", tone: "danger" });
  });
});

describe("helpers", () => {
  it("reads a duration from the title or note", () => {
    expect(bookedMinutes(item({ title: "x", details: { note: "Nonstop · 2 hr 05 min" } }))).toBe(125);
    expect(bookedMinutes(item({ title: "UA 1" }))).toBeNull();
    expect(duration(125)).toBe("2h 05m");
  });
});

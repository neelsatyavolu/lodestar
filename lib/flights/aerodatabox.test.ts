import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearFlightCache, flightStatus, freshFor, toStatus } from "./aerodatabox";

// Trimmed from a real AeroDataBox answer for WN 4623 on 2026-11-21.
const wn4623 = {
  departure: {
    airport: { iata: "SFO", name: "San Francisco", municipalityName: "San Francisco", timeZone: "America/Los_Angeles" },
    scheduledTime: { utc: "2026-11-21 18:20Z", local: "2026-11-21 10:20-08:00" },
    terminal: "2",
    quality: ["Basic"],
  },
  arrival: {
    airport: { iata: "PHX", name: "Phoenix Sky Harbor", municipalityName: "Phoenix", timeZone: "America/Phoenix" },
    scheduledTime: { utc: "2026-11-21 20:25Z", local: "2026-11-21 13:25-07:00" },
    predictedTime: { utc: "2026-11-21 20:33Z", local: "2026-11-21 13:33-07:00" },
    terminal: "4",
    quality: ["Basic"],
  },
  status: "Expected",
  aircraft: { model: "Boeing 737-800" },
  airline: { name: "Southwest Airlines", iata: "WN" },
};

const HOUR = 3_600_000;
const departs = Date.parse("2026-11-21T18:20:00Z");

describe("toStatus", () => {
  it("reads both ends with local times and zones", () => {
    const s = toStatus(wn4623, departs - 9 * 24 * HOUR)!;
    expect(s.phase).toBe("scheduled");
    expect(s.departure).toMatchObject({ code: "SFO", city: "San Francisco", zone: "PST", terminal: "2", gate: null, scheduled: { date: "2026-11-21", time: "10:20" }, latest: null });
    // Nine days out the model's 13:33 guess is left out.
    expect(s.arrival).toMatchObject({ code: "PHX", zone: "MST", terminal: "4", latest: null, actual: false });
    expect(toStatus(wn4623, departs - 2 * HOUR)?.arrival.latest?.time).toBe("13:33");
    expect(s.aircraft).toBe("Boeing 737-800");
    expect(s.delay).toBeNull();
  });

  it("calls a late Expected flight delayed and counts the minutes", () => {
    const late = { ...wn4623, departure: { ...wn4623.departure, revisedTime: { utc: "2026-11-21 19:05Z", local: "2026-11-21 11:05-08:00" } } };
    const s = toStatus(late, 1)!;
    expect(s.phase).toBe("delayed");
    expect(s.delay).toBe(45);
    expect(s.departure.latest?.time).toBe("11:05");
  });

  it("marks a runway time as what happened", () => {
    const landed = { ...wn4623, status: "Arrived", arrival: { ...wn4623.arrival, runwayTime: { utc: "2026-11-21 20:16Z", local: "2026-11-21 13:16-07:00" }, baggageBelt: "7" } };
    const s = toStatus(landed, 1)!;
    expect(s.phase).toBe("landed");
    expect(s.arrival).toMatchObject({ latest: { time: "13:16" }, actual: true, baggage: "7" });
  });

  it("maps cancellations and refuses junk", () => {
    expect(toStatus({ ...wn4623, status: "Canceled" }, 1)?.phase).toBe("cancelled");
    expect(toStatus({ nope: true }, 1)).toBeNull();
  });
});

describe("freshFor", () => {
  it("asks rarely weeks out and every few minutes on travel day", () => {
    expect(freshFor(departs, departs - 9 * 24 * HOUR)).toBe(12 * HOUR);
    expect(freshFor(departs, departs - 2 * HOUR)).toBe(4 * 60_000);
    expect(freshFor(departs, departs + 3 * HOUR)).toBe(4 * 60_000);
  });
});

describe("flightStatus", () => {
  beforeEach(() => clearFlightCache());
  const q = { airline: "WN", number: "4623", date: "2026-11-21", from: "SFO" };
  const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

  it("asks once and serves the cached answer until it goes stale", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reply(200, [wn4623]));
    const now = departs - 9 * 24 * HOUR;
    expect((await flightStatus("k", q, now, fetcher))?.departure.code).toBe("SFO");
    await flightStatus("k", q, now + HOUR, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await flightStatus("k", q, now + 13 * HOUR, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain("/flights/number/WN4623/2026-11-21");
  });

  it("picks the leg leaving the trip's airport", async () => {
    const other = { ...wn4623, departure: { ...wn4623.departure, airport: { ...wn4623.departure.airport, iata: "LAS" } } };
    const s = await flightStatus("k", q, 0, async () => reply(200, [other, wn4623]));
    expect(s?.departure.code).toBe("SFO");
  });

  it("returns null for an unknown flight and keeps the last answer when over quota", async () => {
    expect(await flightStatus("k", q, 0, async () => reply(204))).toBeNull();
    clearFlightCache();
    const now = departs - 2 * HOUR;
    await flightStatus("k", q, now, async () => reply(200, [wn4623]));
    expect((await flightStatus("k", q, now + 10 * 60_000, async () => reply(429)))?.departure.code).toBe("SFO");
  });

  it("throws when the key is refused", async () => {
    await expect(flightStatus("bad", q, 0, async () => reply(403))).rejects.toThrow(/refused the key/);
  });
});

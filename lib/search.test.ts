import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itin, route } from "./test-fixtures";
import { SearchQuerySchema } from "./types";

const searchFlights = vi.fn();
const searchDates = vi.fn();
vi.mock("./fares", async (orig) => ({ ...(await orig<typeof import("./fares")>()), searchFlights, searchDates }));

const { runSearch, runCalendar, resolveCodes, applyAvoidances } = await import("./search");

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("resolveCodes", () => {
  it("expands metros and rejects unknown codes", () => {
    expect(resolveCodes(["NYC", "JFK"])).toEqual(["JFK", "EWR", "LGA"]);
    expect(() => resolveCodes(["QQQ"])).toThrow(/QQQ/);
  });
});

describe("runSearch", () => {
  beforeEach(() => {
    searchFlights.mockReset();
    searchDates.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("adds nearby airports, runs flex and split searches, and builds hacks", async () => {
    const depart = future(30);
    const ret = future(35);
    searchFlights.mockImplementation(async (p: { returnDate?: string | null; origins: string[] }) => {
      if (p.returnDate) return [itin(400, [route("SFO", "JFK"), route("JFK", "SFO")]), itin(330, [route("OAK", "JFK"), route("JFK", "OAK")], "oak")];
      return p.origins.includes("SFO") ? [itin(150, [route("SFO", "JFK")], "out")] : [itin(140, [route("JFK", "SFO")], "back")];
    });
    searchDates.mockResolvedValue([{ depart: future(28), return: future(33), price: 300 }, { depart, return: ret, price: 400 }]);

    const q = SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart, return: ret });
    const result = await runSearch(q, undefined, { calendarMs: 5000 });

    const mainCall = searchFlights.mock.calls.find(([p]) => p.returnDate)![0];
    expect(mainCall.origins).toEqual(expect.arrayContaining(["SFO", "OAK", "SJC"]));
    expect(searchDates.mock.calls[0][0].tripDays).toBe(5);
    expect(result.hacks.map((h) => h.kind)).toEqual(expect.arrayContaining(["nearby", "flex", "split"]));
    expect(result.hacks[0].saving).toBeGreaterThanOrEqual(result.hacks.at(-1)!.saving);
    expect(result.oneWays?.out[0].id).toBe("out");
    expect(result.warnings).toEqual([]);
  });

  it("keeps going when side searches fail", async () => {
    searchFlights.mockImplementation(async (p: { returnDate?: string | null }) => {
      if (p.returnDate) return [itin(400, [route("SFO", "JFK"), route("JFK", "SFO")])];
      throw new Error("timeout");
    });
    searchDates.mockRejectedValue(new Error("dates down"));
    const q = SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: future(20), return: future(25), nearby: false });
    const result = await runSearch(q, undefined, { calendarMs: 5000 });
    expect(result.itineraries).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/dates down/);
    expect(result.oneWays).toBeNull();
  });

  it("skips the calendar unless asked, and caps it with a deadline", async () => {
    searchFlights.mockResolvedValue([itin(300)]);
    const q = SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: future(20), nearby: false });
    await runSearch(q);
    expect(searchDates).not.toHaveBeenCalled();
    searchDates.mockImplementation(() => new Promise(() => {}));
    const slow = await runSearch(q, undefined, { calendarMs: 20 });
    expect(slow.calendar).toEqual([]);
    expect(slow.warnings.join(" ")).toMatch(/too long/);
    expect(slow.baseline).toBe(300);
  });

  it("builds the calendar window around the date", async () => {
    searchDates.mockResolvedValue([]);
    await runCalendar(SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: future(20), return: future(27) }));
    const args = searchDates.mock.calls[0][0];
    expect(args.start).toBe(future(17));
    expect(args.end).toBe(future(23));
    expect(args.tripDays).toBe(7);
  });

  it("prices a visible window, capped at two months and never in the past", async () => {
    searchDates.mockReset();
    searchDates.mockResolvedValue([]);
    const q = SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: future(20), return: future(25) });
    await runCalendar(q, undefined, { start: future(-10), end: future(200) });
    const args = searchDates.mock.calls[0][0];
    expect(args.start).toBe(future(1));
    expect(args.end).toBe(future(62));
    expect(args.tripDays).toBe(5);
  });

  it("rejects past dates and same-airport trips", async () => {
    await expect(runSearch(SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: "2020-01-01" }))).rejects.toThrow(/passed/);
    await expect(runSearch(SearchQuerySchema.parse({ from: ["SFO"], to: ["SFO"], depart: future(10) }))).rejects.toThrow(/same/);
  });
});

describe("applyAvoidances", () => {
  const redEye = itin(150, [route("LAX", "JFK", { depart: "2026-12-10T23:00:00", arrive: "2026-12-11T07:00:00" })], "red");
  const self = itin(160, [{ ...route("LAX", "JFK"), self_transfer: true }], "self");
  const normal = itin(200, [route("LAX", "JFK")], "ok");

  it("drops what the traveller avoids", () => {
    const warnings: string[] = [];
    const out = applyAvoidances([redEye, self, normal], { avoidRedEyes: true, avoidSelfTransfer: true }, warnings);
    expect(out.map((i) => i.id)).toEqual(["ok"]);
    expect(warnings).toEqual([]);
  });

  it("never empties the results", () => {
    const warnings: string[] = [];
    expect(applyAvoidances([redEye], { avoidRedEyes: true, avoidSelfTransfer: true }, warnings).map((i) => i.id)).toEqual(["red"]);
    expect(warnings[0]).toMatch(/red-eye/);
  });

  it("passes filters through to the fares service", async () => {
    searchFlights.mockReset();
    searchFlights.mockResolvedValue([normal]);
    const q = SearchQuerySchema.parse({ from: ["LAX"], to: ["JFK"], depart: future(20), nearby: false, alliances: ["ONEWORLD"], avoidAirlines: ["nk"], noBasicEconomy: true });
    await runSearch(q);
    expect(searchFlights.mock.calls[0][0]).toMatchObject({ alliances: ["ONEWORLD"], excludeAirlines: ["NK"], excludeBasic: true });
  });
});

describe("automatic hack searches", () => {
  beforeEach(() => {
    searchFlights.mockReset();
    searchDates.mockReset();
  });

  it("runs cabin, trip-length and group checks for a round trip with two adults", async () => {
    searchFlights.mockImplementation(async (p: { cabin?: string; adults?: number; returnDate?: string | null; depart: string }) => {
      if (p.cabin === "PREMIUM_ECONOMY") return [itin(760, [route("SFO", "JFK"), route("JFK", "SFO")], "pe")];
      if (p.adults === 1) return [itin(300, [route("SFO", "JFK"), route("JFK", "SFO")], "one")];
      return [itin(700, [route("SFO", "JFK"), route("JFK", "SFO")], "main")];
    });
    const q = SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: future(30), return: future(35), adults: 2, nearby: false, split: false });
    const result = await runSearch(q);
    const calls = searchFlights.mock.calls.map(([p]) => p);
    expect(calls.some((p) => p.cabin === "PREMIUM_ECONOMY")).toBe(true);
    expect(calls.some((p) => p.returnDate === future(34))).toBe(true);
    expect(calls.some((p) => p.returnDate === future(36))).toBe(true);
    expect(calls.some((p) => p.adults === 1)).toBe(true);
    expect(calls.filter((p) => p.expand === 2).length).toBeGreaterThanOrEqual(4);
    const kinds = result.hacks.map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(["cabin", "group"]));
  });

  it("checks a round trip for one-way searches", async () => {
    searchFlights.mockImplementation(async (p: { returnDate?: string | null }) =>
      p.returnDate ? [itin(250, [route("SFO", "JFK"), route("JFK", "SFO")], "rt")] : [itin(400, [route("SFO", "JFK")], "ow")],
    );
    const result = await runSearch(SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: future(30), nearby: false }));
    expect(result.hacks.find((h) => h.kind === "throwaway")?.saving).toBe(150);
  });

  it("does not wait on a hung extra search", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchFlights.mockImplementation((p: { expand?: number }) => (p.expand === 2 ? new Promise(() => {}) : Promise.resolve([itin(300)])));
    const pending = runSearch(SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: future(30), nearby: false }));
    await vi.advanceTimersByTimeAsync(10_500);
    const result = await pending;
    vi.useRealTimers();
    expect(result.itineraries).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });
});

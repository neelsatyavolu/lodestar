import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itin, route } from "./test-fixtures";
import { SearchQuerySchema } from "./types";

const searchFlights = vi.fn();
const searchDates = vi.fn();
vi.mock("./fares", async (orig) => ({ ...(await orig<typeof import("./fares")>()), searchFlights, searchDates }));

const { runSearch, runCalendar, resolveCodes } = await import("./search");

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

  it("rejects past dates and same-airport trips", async () => {
    await expect(runSearch(SearchQuerySchema.parse({ from: ["SFO"], to: ["JFK"], depart: "2020-01-01" }))).rejects.toThrow(/passed/);
    await expect(runSearch(SearchQuerySchema.parse({ from: ["SFO"], to: ["SFO"], depart: future(10) }))).rejects.toThrow(/same/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { FaresError, bookingPage, searchDates, searchFlights } from "./fares";
import { itin } from "./test-fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("fares client", () => {
  it("maps params and validates the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ itineraries: [itin(100)], round_trip: false }));
    vi.stubGlobal("fetch", fetchMock);
    const items = await searchFlights({ origins: ["SFO"], destinations: ["JFK"], depart: "2026-12-10", bags: 1 });
    expect(items[0].price).toBe(100);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ origins: ["SFO"], return_date: null, checked_bags: 1, passengers: { adults: 1, children: 0 } });
  });

  it("passes the service's error detail through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: "Unknown airport code QQQ." }, { status: 400 })));
    await expect(searchFlights({ origins: ["QQQ"], destinations: ["JFK"], depart: "2026-12-10" })).rejects.toMatchObject({ message: "Unknown airport code QQQ.", status: 400 });
  });

  it("fails loudly on an unexpected shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ days: "nope" })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(searchDates({ origins: ["SFO"], destinations: ["JFK"], start: "2026-12-01", end: "2026-12-05" })).rejects.toBeInstanceOf(FaresError);
  });

  it("explains an unreachable service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(bookingPage("CBwQAho_EgoyMDI2LTEy")).rejects.toMatchObject({ status: 503 });
  });
});

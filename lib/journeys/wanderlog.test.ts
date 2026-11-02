import { describe, expect, it, vi } from "vitest";
import { destinationFromTitle, getWanderlogTrip, listWanderlogTrips, mapWanderlogTrip, sessionCookie, WanderlogError } from "./wanderlog";

const SID = "s%3AF5Vu5WHq71X74juZzedvcm0w0gX2D_Bk.TpxqthqZBaBfZyQb";

const fakeFetch = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
/** Answers /api/user as a signed-in user, everything else with `body`. */
const signedIn = (body: unknown, user: unknown = { id: 42 }) =>
  vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/user") ? { user } : body), { status: 200 })) as unknown as typeof fetch;

describe("Wanderlog session", () => {
  it("accepts the cookie however it was copied", () => {
    expect(sessionCookie(SID)).toBe(`connect.sid=${SID}`);
    expect(sessionCookie(`connect.sid=${SID}; other=1`)).toBe(`connect.sid=${SID}`);
    expect(sessionCookie(`s:${SID.slice(4)}`)).toBe(`connect.sid=${SID}`);
    expect(sessionCookie("hunter2")).toBeNull();
    expect(sessionCookie(`${SID}\r\nX-Evil: 1`)).toBeNull();
  });
});

describe("Wanderlog API", () => {
  it("lists own and privately shared trips once each, newest first", async () => {
    const fetcher = signedIn({
      ownTripPlans: [{ key: "aaaa1", title: "Trip to Lisbon", startDate: "2025-05-01", endDate: "2025-05-05", placeCount: 12 }, { key: "bad key!", title: "x" }],
      friendsPrivateSharedTripPlans: [{ key: "bbbb2", title: "Tokyo", startDate: "2026-03-01", endDate: null }, { key: "aaaa1" }],
      friendsTripPlans: [{ key: "public1", title: "Someone else's" }],
    });
    expect(await listWanderlogTrips(`connect.sid=${SID}`, fetcher)).toEqual([
      { key: "bbbb2", title: "Tokyo", startDate: "2026-03-01", endDate: null, places: 0 },
      { key: "aaaa1", title: "Trip to Lisbon", startDate: "2025-05-01", endDate: "2025-05-05", places: 12 },
    ]);
    const [url, init] = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(url).toBe("https://wanderlog.com/api/tripPlans/home");
    expect((init.headers as Record<string, string>).Cookie).toBe(`connect.sid=${SID}`);
  });

  it("explains a rejected session and a missing trip", async () => {
    await expect(listWanderlogTrips("c", fakeFetch(401, {}))).rejects.toMatchObject({ status: 401, message: expect.stringContaining("fresh") });
    // Wanderlog answers a bad session as a guest rather than refusing it.
    await expect(listWanderlogTrips("c", signedIn({ ownTripPlans: [] }, null))).rejects.toMatchObject({ status: 401 });
    await expect(getWanderlogTrip("c", "k", fakeFetch(200, {}))).rejects.toBeInstanceOf(WanderlogError);
    await expect(getWanderlogTrip("c", "k", fakeFetch(500, {}))).rejects.toMatchObject({ status: 502 });
  });
});

describe("mapping a Wanderlog trip", () => {
  it("brings flights, trains, hotels and dated places; skips notes and undated ideas", () => {
    const mapped = mapWanderlogTrip({
      title: "Trip to Tokyo",
      startDate: "2026-03-01",
      endDate: "2026-03-08",
      itinerary: {
        sections: [
          { type: "flights", blocks: [{ type: "flight", flightInfo: { airline: { iata: "NH", name: "ANA" }, number: 7 }, depart: { airport: { iata: "SFO" }, date: "2026-03-01", time: "11:30" }, arrive: { airport: { iata: "HND" }, date: "2026-03-02", time: "15:30" }, confirmationNumber: "ABC" }] },
          { type: "hotels", blocks: [{ type: "place", place: { name: "Hotel Gracery", formatted_address: "Kabukicho, Tokyo" }, hotel: { checkIn: "2026-03-02", checkOut: "2026-03-08", confirmationNumber: "H9" } }] },
          { type: "normal", heading: "Ideas", blocks: [{ type: "place", place: { name: "Somewhere someday" } }, { type: "note", text: { ops: [{ insert: "hi" }] } }] },
          {
            type: "normal",
            mode: "dayPlan",
            date: "2026-03-03",
            blocks: [
              { type: "place", place: { name: "Tsukiji Outer Market", types: ["food", "market"], rating: 4.4 }, startTime: "2026-03-03T09:00:00Z" },
              { type: "place", place: { name: "teamLab Planets", types: ["museum"] }, startTime: "14:00", endTime: "16:00" },
              { type: "rentalCar", pickUp: { date: "2026-03-03", time: "08:00", place: { name: "Times Car Shinjuku", formatted_address: "Shinjuku, Tokyo" } }, dropOff: { date: "2026-03-05", time: "18:00" }, confirmationNumber: "CAR1" },
              { type: "train", carrier: "JR", depart: { place: { name: "Tokyo" }, date: "2026-03-03", time: "18:00" }, arrive: { place: { name: "Kyoto" }, date: "2026-03-03", time: "20:15" } },
            ],
          },
        ],
      },
    });
    expect(mapped).toMatchObject({ title: "Trip to Tokyo", destination: "Tokyo", startDate: "2026-03-01", endDate: "2026-03-08" });
    expect(mapped.items.map((i) => [i.kind, i.status, i.title, i.startDate, i.startTime])).toEqual([
      ["flight", "booked", "NH 7 · SFO → HND", "2026-03-01", "11:30"],
      ["stay", "booked", "Hotel Gracery", "2026-03-02", null],
      ["dining", "planned", "Tsukiji Outer Market", "2026-03-03", "09:00"],
      ["activity", "planned", "teamLab Planets", "2026-03-03", "14:00"],
      ["transport", "booked", "Rental car pickup · Times Car Shinjuku", "2026-03-03", "08:00"],
      ["transport", "booked", "JR · Tokyo → Kyoto", "2026-03-03", "18:00"],
    ]);
    expect(mapped.items[0]).toMatchObject({ place: "Tokyo", confirmation: "ABC", endTime: "15:30" });
    expect(mapped.items[2].details.rating).toBe(4.4);
  });

  it("copes with an empty or odd trip", () => {
    expect(mapWanderlogTrip(null)).toEqual({ title: "Wanderlog trip", destination: "Wanderlog trip", startDate: null, endDate: null, items: [] });
    expect(destinationFromTitle("Weekend in Big Sur")).toBe("Big Sur");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "../db/client";
import { migrate } from "../db/schema";
import { clearBooking, insertTrip, listTrips, setBooking, updateTripAlerts } from "../db/trips";
import { insertUser } from "../db/users";
import { BookingSchema } from "./booked";
import { checkTrips, type CheckDeps } from "./check";
import { buildQueries, SaveTripSchema } from "./input";
import type { TripAlert } from "./mail";

let db: Db;
const userId = "00000000-0000-4000-8000-000000000001";
const tripId = "10000000-0000-4000-8000-000000000001";
const TFS = "CBwQAhoeEgoyMDI2LTEyLTA3agcIARIDU0ZP";
const input = SaveTripSchema.parse({
  snapshot: { prompt: "Chennai", plan: {}, canvas: { headline: "x" }, options: { a: { itinerary: { tfs: TFS, slices: [{ legs: [{ depart: "2026-12-14T09:05" }] }] }, search: 0 } } },
  searches: [
    { label: "a", from: ["SFO"], to: ["MAA"], depart: "2026-12-07", return: "2026-12-20" },
    { label: "b", from: ["SJC"], to: ["MAA"], depart: "2026-12-08", return: "2026-12-21" },
  ],
  price: 1822,
});

let sent: { to: string; alert: TripAlert }[];
const deps = (fares: (number | null)[], over: Partial<CheckDeps> = {}): CheckDeps => {
  let i = 0;
  return {
    db,
    today: "2026-11-02",
    now: () => 1_000,
    appUrl: "https://lodestar.xanom.co",
    cheapest: async () => fares[i++ % fares.length],
    bookedPrice: async () => {
      throw new Error("not booked");
    },
    mayEmail: async () => true,
    email: async (to, alert) => void sent.push({ to, alert }),
    batch: 10,
    deadline: 10_000,
    ...over,
  };
};

beforeEach(async () => {
  sent = [];
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: userId, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
  await insertTrip(db, userId, { id: tripId, title: "SFO → MAA", prompt: "Chennai", queries: buildQueries(input), snapshot: input.snapshot, firstDepart: "2026-12-07", price: 1822, createdAt: 1 });
});

describe("daily trip check", () => {
  it("takes the cheapest fare across the trip's searches and emails a drop once", async () => {
    expect(await checkTrips(deps([1900, 1650]))).toEqual({ checked: 1, emailed: 1, skipped: 0 });
    expect(sent[0]).toMatchObject({ to: "ada@example.com", alert: { cheapest: 1650, previous: 1822, reasons: ["drop"], url: `https://lodestar.xanom.co/?trip=${tripId}` } });
    const [t] = await listTrips(db, userId);
    expect(t.lastPrice).toBe(1650);

    expect(await checkTrips(deps([1650]))).toMatchObject({ checked: 1, emailed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("records the fare but keeps the alert armed when email is unavailable", async () => {
    await checkTrips(deps([1500], { mayEmail: async () => false }));
    expect(sent).toHaveLength(0);
    await checkTrips(deps([1500]));
    expect(sent).toHaveLength(1);
  });

  it("keeps the last known fare when every search fails, and still sends a due reminder", async () => {
    await updateTripAlerts(db, userId, tripId, { alertDrop: false, remindOn: "2026-11-02" });
    await checkTrips(deps([null]));
    expect(sent[0].alert.reasons).toEqual(["remind"]);
    expect((await listTrips(db, userId))[0]).toMatchObject({ lastPrice: null, reminded: true });
  });

  it("stops starting trips after the deadline", async () => {
    expect(await checkTrips(deps([1500], { deadline: 0 }))).toEqual({ checked: 0, emailed: 0, skipped: 1 });
  });

  describe("once booked", () => {
    const booking = BookingSchema.parse({ tfs: TFS, seller: "United", isAirline: true, fare: "Economy", paid: 1900, changes: "free", refunds: "none" });

    it("only accepts an itinerary from the trip's own shortlist", async () => {
      expect(await setBooking(db, userId, tripId, { ...booking, tfs: "ZZZZZZZZZZZZZZZZZZZZ" })).toBeNull();
      expect(await setBooking(db, userId, tripId, booking)).toMatchObject({ booking: { seller: "United", paid: 1900 } });
    });

    it("watches the booked fare against what was paid, not the cheapest search fare", async () => {
      await updateTripAlerts(db, userId, tripId, { targetPrice: 2000, remindOn: "2026-11-02" });
      await setBooking(db, userId, tripId, booking);
      const seen: unknown[] = [];
      await checkTrips(deps([100], { bookedPrice: async (b) => (seen.push(b), 1800) }));
      expect(seen).toEqual([booking]);
      expect(sent).toHaveLength(1);
      expect(sent[0].alert).toMatchObject({ reasons: ["drop"], cheapest: 1800, previous: 1900, booking: { paid: 1900 } });
      expect((await listTrips(db, userId))[0]).toMatchObject({ lastPrice: 1800, targetPrice: null, remindOn: null });
    });

    it("watches until the booked flight leaves, and back to the first search date on undo", async () => {
      expect(await setBooking(db, userId, tripId, booking)).toMatchObject({ firstDepart: "2026-12-14" });
      expect(await clearBooking(db, userId, tripId)).toMatchObject({ firstDepart: "2026-12-07" });
    });

    it("drops a check's result when the trip was booked while it ran", async () => {
      await checkTrips(deps([1500], { mayEmail: async () => (await setBooking(db, userId, tripId, booking), false) }));
      expect((await listTrips(db, userId))[0]).toMatchObject({ lastPrice: null, booking: { paid: 1900 } });
    });

    it("keeps quiet when the booked fare isn't listed any more", async () => {
      await setBooking(db, userId, tripId, booking);
      await checkTrips(deps([100], { bookedPrice: async () => null }));
      expect(sent).toHaveLength(0);
    });

    it("goes back to watching the shortlist from its saved fare when unbooked", async () => {
      await setBooking(db, userId, tripId, booking);
      expect(await clearBooking(db, userId, tripId)).toMatchObject({ booking: null });
      await checkTrips(deps([1700]));
      expect(sent[0].alert).toMatchObject({ cheapest: 1700, previous: 1822, booking: null });
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { buildQueries, SaveTripSchema, tripTitle } from "../trips/input";
import { createPgliteDb, type Db } from "./client";
import { migrate } from "./schema";
import { countTrips, deleteTrip, dueTrips, getTripSnapshot, insertTrip, listTrips, recordCheck, updateTripAlerts } from "./trips";
import { deleteUser, insertUser } from "./users";

let db: Db;
const ada = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const tripId = "10000000-0000-4000-8000-000000000001";

const input = SaveTripSchema.parse({
  snapshot: { prompt: "Chennai in December", plan: { searches: [] }, canvas: { headline: "Cathay is the pick" }, options: { "S1-1": { itinerary: { id: "x", price: 1822 }, search: 0 } } },
  searches: [{ label: "Exact dates", from: ["sfo"], to: ["MAA"], depart: "2026-12-07", return: "2026-12-20" }],
  filters: { alliances: ["ONEWORLD"] },
  price: 1822,
});

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: ada, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
  await insertUser(db, { id: bob, email: "bob@example.com", passwordHash: "x", createdAt: 1 });
  const queries = buildQueries(input);
  await insertTrip(db, ada, { id: tripId, title: tripTitle(queries[0]), prompt: input.snapshot.prompt, queries, snapshot: input.snapshot, firstDepart: "2026-12-07", price: input.price, createdAt: 1000 });
});

describe("saved trips", () => {
  it("builds valid queries with the filters and a readable title", () => {
    const [q] = buildQueries(input);
    expect(q).toMatchObject({ from: ["SFO"], to: ["MAA"], alliances: ["ONEWORLD"] });
    expect(tripTitle(q)).toBe("SFO → MAA · Dec 7 – Dec 20");
  });

  it("lists, opens and deletes only the owner's trips", async () => {
    expect(await countTrips(db, ada)).toBe(1);
    const [t] = await listTrips(db, ada);
    expect(t).toMatchObject({ id: tripId, savedPrice: 1822, alertDrop: true, targetPrice: null, firstDepart: "2026-12-07" });
    expect(await listTrips(db, bob)).toEqual([]);
    expect(await getTripSnapshot(db, bob, tripId)).toBeNull();
    expect((await getTripSnapshot(db, ada, tripId))?.canvas.headline).toBe("Cathay is the pick");
    expect(await deleteTrip(db, bob, tripId)).toBe(false);
    expect(await deleteTrip(db, ada, tripId)).toBe(true);
    expect(await countTrips(db, ada)).toBe(0);
  });

  it("re-arms a target or reminder when it changes, and refuses other accounts", async () => {
    await recordCheck(db, tripId, null, { lastPrice: 1700, checkedAt: 2000, alertPrice: 1700, targetHit: true, reminded: true });
    expect(await updateTripAlerts(db, bob, tripId, { alertDrop: false })).toBeNull();
    const t = await updateTripAlerts(db, ada, tripId, { targetPrice: 1500, remindOn: "2026-11-20", alertDrop: false });
    expect(t).toMatchObject({ targetPrice: 1500, targetHit: false, remindOn: "2026-11-20", reminded: false, alertDrop: false, lastPrice: 1700 });
  });

  it("finds trips due a check, least recently checked first, and stops after departure", async () => {
    const due = await dueTrips(db, "2026-11-02", 10);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ email: "ada@example.com", alertPrice: 1822, queries: [expect.objectContaining({ to: ["MAA"] })] });
    expect(await dueTrips(db, "2026-12-07", 10)).toEqual([]);
    await updateTripAlerts(db, ada, tripId, { alertDrop: false });
    expect(await dueTrips(db, "2026-11-02", 10)).toEqual([]);
  });

  it("goes away with the account", async () => {
    await deleteUser(db, ada);
    expect(await countTrips(db, ada)).toBe(0);
  });
});

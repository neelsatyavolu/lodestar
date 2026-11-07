import { beforeEach, describe, expect, it } from "vitest";
import { DraftItemSchema } from "../journeys/types";
import { addItems, addTripCost, addTripTasks, createTrip, patchCost, patchItem, patchTask, removeTask, setSharing, updateTrip, writeNote } from "../server/plan-ops";
import { createPgliteDb, type Db } from "./client";
import { deleteJourney, getJourney, sharedJourney } from "./journeys";
import { migrate } from "./schema";
import { insertUser } from "./users";

let db: Db;
const ada = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const newTrip = { destination: "Tucson", startDate: "2026-11-21", endDate: "2026-11-26", travelers: 4, tripType: "family" as const };

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: ada, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
  await insertUser(db, { id: bob, email: "bob@example.com", passwordHash: "x", createdAt: 1 });
});

describe("planning a trip", () => {
  it("starts a trip with who's going, the kind of trip and a starter checklist", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    const trip = await getJourney(db, ada, id);
    expect(trip).toMatchObject({ destination: "Tucson", travelers: 4, tripType: "family", shareToken: null, notes: [], costs: [] });
    expect(trip!.tasks.map((t) => t.title)).toContain("Snacks and entertainment for the travel days");
    expect(trip!.tasks.map((t) => t.position)).toEqual(trip!.tasks.map((_, i) => i));
  });

  it("refuses dates that end before they start, counting the dates already set", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    await expect(updateTrip(db, ada, id, { endDate: "2026-11-01" })).rejects.toThrow("ends before it starts");
    expect(await updateTrip(db, ada, id, { travelers: 2, tripType: null })).toMatchObject({ travelers: 2, tripType: null });
  });

  it("sets and clears booking facts on an item without touching its other details", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    const draft = DraftItemSchema.parse({ kind: "activity", status: "planned", title: "Spa", startDate: "2026-11-24", details: { phone: "(520) 572-3030", note: "18+" } });
    const [itemId] = await addItems(db, ada, id, [draft], "agent");
    const set = await patchItem(db, ada, itemId, { facts: { reserve: true, bookBy: "2026-11-15", estimate: 600 } });
    expect(set.details).toMatchObject({ phone: "(520) 572-3030", note: "18+", reserve: true, bookBy: "2026-11-15", estimate: 600 });
    const booked = await patchItem(db, ada, itemId, { status: "booked", confirmation: "SPA1", facts: { estimate: null, price: 580 } });
    expect(booked).toMatchObject({ status: "booked", confirmation: "SPA1", source: "agent" });
    expect(booked.details).not.toHaveProperty("estimate");
    expect(booked.details).toMatchObject({ price: 580, note: "18+" });
  });

  it("keeps the checklist in order, ticks items off and removes them", async () => {
    const id = await createTrip(db, ada, { ...newTrip, tripType: null }, "manual");
    const before = (await getJourney(db, ada, id))!.tasks.length;
    const [a, b] = await addTripTasks(db, ada, id, [{ title: "Book the spa", due: "2026-11-15", section: "Bookings" }, { title: "Print boarding passes", due: null, section: "Before you go" }], "agent");
    expect([a.position, b.position]).toEqual([before, before + 1]);
    expect(await patchTask(db, ada, a.id, { done: true })).toMatchObject({ done: true, due: "2026-11-15", source: "agent" });
    await removeTask(db, ada, b.id);
    expect((await getJourney(db, ada, id))!.tasks).toHaveLength(before + 1);
  });

  it("replaces a note with the same title instead of adding another", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    await writeNote(db, ada, id, { title: "Dietary needs", body: "Two vegetarians." }, "manual");
    await writeNote(db, ada, id, { title: "dietary needs", body: "Two lacto-ovo vegetarians; no fish stock." }, "agent");
    const { notes } = (await getJourney(db, ada, id))!;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: "dietary needs", body: "Two lacto-ovo vegetarians; no fish stock." });
  });

  it("records budget lines with exact amounts", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    const fee = await addTripCost(db, ada, id, { label: "Resort fee", amount: 343.65, currency: "USD", category: "stays", paid: false }, "manual");
    expect(await patchCost(db, ada, fee.id, { paid: true })).toMatchObject({ amount: 343.65, paid: true });
  });

  it("deletes a trip's checklist, notes and costs with it", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    await writeNote(db, ada, id, { title: "Plan", body: "Rest first." }, "manual");
    await addTripCost(db, ada, id, { label: "Gas", amount: 100, currency: "USD", category: "transport", paid: false }, "manual");
    await deleteJourney(db, ada, id);
    for (const table of ["journey_tasks", "journey_notes", "journey_costs"]) expect(await db.query(`SELECT 1 FROM ${table}`)).toEqual([]);
  });
});

describe("one account can't touch another's plan", () => {
  it("refuses every write to someone else's trip or its entries", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    const [task] = (await getJourney(db, ada, id))!.tasks;
    const draft = DraftItemSchema.parse({ kind: "activity", title: "Hike", startDate: "2026-11-22" });
    await expect(addItems(db, bob, id, [draft], "agent")).rejects.toThrow("doesn't exist");
    await expect(addTripTasks(db, bob, id, [{ title: "x", due: null, section: "x" }], "agent")).rejects.toThrow("doesn't exist");
    await expect(writeNote(db, bob, id, { title: "x", body: "y" }, "agent")).rejects.toThrow("doesn't exist");
    await expect(addTripCost(db, bob, id, { label: "x", amount: 1, currency: "USD", category: "other", paid: false }, "agent")).rejects.toThrow("doesn't exist");
    await expect(patchTask(db, bob, task.id, { done: true })).rejects.toThrow("doesn't exist");
    await expect(setSharing(db, bob, id, true)).rejects.toThrow("doesn't exist");
    expect(await getJourney(db, bob, id)).toBeNull();
  });
});

describe("sharing", () => {
  it("opens the trip by its secret link until sharing is turned off", async () => {
    const id = await createTrip(db, ada, newTrip, "manual");
    const token = (await setSharing(db, ada, id, true))!;
    expect(token).toMatch(/^[\w-]{32}$/);
    expect(await setSharing(db, ada, id, true)).toBe(token);
    expect((await sharedJourney(db, token))?.id).toBe(id);
    expect(await setSharing(db, ada, id, false)).toBeNull();
    expect(await sharedJourney(db, token)).toBeNull();
    const fresh = await setSharing(db, ada, id, true);
    expect(fresh).not.toBe(token);
  });
});

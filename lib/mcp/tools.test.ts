import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "../db/client";
import { getJourney } from "../db/journeys";
import { savePreferences } from "../db/preferences";
import { DEFAULT_PREFERENCES } from "../preferences";
import { migrate } from "../db/schema";
import { insertUser } from "../db/users";
import { runTool, TOOLS, type ToolCtx } from "./tools";

let db: Db;
const ada = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const today = "2026-11-07";

const call = async (name: string, args: unknown, userId = ada) => {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  const ctx: ToolCtx = { db, userId, today };
  return runTool(def, ctx, args);
};
const okData = async (name: string, args: unknown, userId = ada) => {
  const r = await call(name, args, userId);
  if (!r.ok) throw new Error(r.message);
  return r.result;
};

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: ada, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
  await insertUser(db, { id: bob, email: "bob@example.com", passwordHash: "x", createdAt: 1 });
});

describe("Trips tools", () => {
  it("every tool has a description and an object input schema", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.input.def.type, t.name).toBe("object");
    }
  });

  it("let an agent build a whole plan and read it back", async () => {
    const { data } = await okData("create_trip", { destination: "Tucson", startDate: "2026-11-21", endDate: "2026-11-26", travelers: 4, tripType: "family" });
    const tripId = (data as { tripId: string }).tripId;
    const added = await okData("add_items", {
      tripId,
      items: [
        { kind: "stay", status: "booked", title: "Ritz-Carlton, Dove Mountain", startDate: "2026-11-21", endDate: "2026-11-26", confirmation: "RC1", details: { price: 6907 } },
        { kind: "activity", title: "Resort spa", startDate: "2026-11-24", startTime: "15:00", details: { reserve: true, bookBy: "2026-11-15", estimate: 600, phone: "(520) 572-3030" } },
      ],
    });
    const [, spaId] = (added.data as { itemIds: string[] }).itemIds;
    await okData("add_tasks", { tripId, tasks: [{ title: "Renew passports" }] });
    await okData("add_packing_items", { tripId, items: ["Hiking boots", "  "] });
    await okData("set_note", { tripId, title: "How the week works", body: "Rest first, one plan each morning." });
    await okData("add_cost", { tripId, label: "Gas", amount: 120, currency: "usd", category: "transport" });

    const trip = await okData("get_trip", { tripId });
    expect(trip.text).toContain("## To book");
    expect(trip.text).toContain(`Resort spa on 2026-11-24, book by 2026-11-15 [item ${spaId}]`);
    expect(trip.text).toContain("### How the week works");
    expect(trip.text).toMatch(/## Packing list\n(- .*\n)*- \[ \] Hiking boots · Packing \[task /);
    expect(trip.text.split("## Packing list")[0]).toContain("Renew passports");
    const budget = (trip.data as { budget: { total: number; currency: string } }).budget;
    expect(budget).toMatchObject({ currency: "USD", total: 6907 + 600 + 120 });

    await okData("update_item", { itemId: spaId, changes: { status: "booked", confirmation: "SPA9", facts: { estimate: null, price: 580 } } });
    const stored = (await getJourney(db, ada, tripId))!;
    expect(stored.items.find((i) => i.id === spaId)).toMatchObject({ status: "booked", confirmation: "SPA9", source: "agent", details: { price: 580 } });
    expect(stored.notes[0]).toMatchObject({ source: "agent" });
    expect(stored.costs[0]).toMatchObject({ currency: "USD", source: "agent" });
  });

  it("list_trips shows only the account's own trips", async () => {
    await okData("create_trip", { destination: "Lisbon" });
    expect((await okData("list_trips", {}, bob)).text).toContain("No trips yet");
    expect((await okData("list_trips", {})).text).toContain("Lisbon");
  });

  it("returns refusals as messages an agent can act on", async () => {
    const { data } = await okData("create_trip", { destination: "Lisbon" });
    const tripId = (data as { tripId: string }).tripId;
    expect(await call("get_trip", { tripId }, bob)).toEqual({ ok: false, message: "That trip doesn't exist." });
    const bad = await call("add_items", { tripId, items: [{ kind: "boat", title: "x", startDate: "2026-11-21" }] });
    expect(bad.ok).toBe(false);
    expect((bad as { message: string }).message).toMatch(/^items\.0\.kind/);
    expect(await call("update_trip", { tripId, changes: { startDate: "2026-12-10", endDate: "2026-12-01" } })).toMatchObject({ ok: false });
  });

  it("get_preferences returns the account's own food taste and home airports", async () => {
    await savePreferences(db, ada, { ...DEFAULT_PREFERENCES, cuisines: ["Japanese", "Seafood"], dietary: ["Vegetarian"], diningBudget: "$$", homeAirports: ["SFO", "SJC"], cabin: "BUSINESS" }, 1);
    const mine = await okData("get_preferences", {});
    expect(mine.data).toEqual({ cuisines: ["Japanese", "Seafood"], dietary: ["Vegetarian"], diningBudget: "$$", homeAirports: ["SFO", "SJC"] });
    expect(mine.text).toContain("Cuisines: Japanese, Seafood");
    expect(mine.text).toContain("Dining budget: $$");
    expect(await okData("get_preferences", {}, bob)).toMatchObject({ data: { cuisines: [], dietary: [], diningBudget: null, homeAirports: [] } });
    expect((await okData("get_preferences", {}, bob)).text).toContain("Dining budget: not set");
  });
});

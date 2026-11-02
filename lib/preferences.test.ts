import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./db/client";
import { getPreferences, savePreferences } from "./db/preferences";
import { migrate } from "./db/schema";
import { insertUser } from "./db/users";
import { DEFAULT_PREFERENCES, PreferencesSchema, readPreferences } from "./preferences";

describe("preferences", () => {
  it("fills defaults and normalises codes", () => {
    const p = PreferencesSchema.parse({ homeAirports: ["sfo", "SFO", "oak"], alliances: ["ONEWORLD"], avoidedAirlines: ["nk"] });
    expect(p.homeAirports).toEqual(["SFO", "OAK"]);
    expect(p.avoidedAirlines).toEqual(["NK"]);
    expect(p.trustedOnly).toBe(true);
    expect(p.avoidSelfTransfer).toBe(true);
  });

  it("rejects bad values", () => {
    expect(PreferencesSchema.safeParse({ alliances: ["PANAM"] }).success).toBe(false);
    expect(PreferencesSchema.safeParse({ homeAirports: ["San Francisco"] }).success).toBe(false);
  });

  it("keeps the good fields of stored JSON with a bad one", () => {
    const p = readPreferences({ alliances: ["SKYTEAM"], cabin: "SPACESHIP" });
    expect(p.alliances).toEqual(["SKYTEAM"]);
    expect(p.cabin).toBe("ECONOMY");
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("saves and reads back per account", async () => {
    const db = await createPgliteDb();
    await migrate(db);
    const id = "11111111-1111-4111-8111-111111111111";
    await insertUser(db, { id, email: "a@example.com", passwordHash: "x", createdAt: 1 });
    expect(await getPreferences(db, id)).toEqual(DEFAULT_PREFERENCES);
    const prefs = PreferencesSchema.parse({ alliances: ["STAR_ALLIANCE"], preferredAirlines: ["UA"], cabin: "BUSINESS" });
    await savePreferences(db, id, prefs, 2);
    await savePreferences(db, id, { ...prefs, cabin: "FIRST" }, 3);
    expect(await getPreferences(db, id)).toEqual({ ...prefs, cabin: "FIRST" });
  });
});

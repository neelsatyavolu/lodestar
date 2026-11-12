import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "./client";
import { upsertItem, upsertJourney } from "./journeys";
import { acceptInvite, accessFor, childOf, INVITE_TTL_MS, inviteMember, leaveTrip, listMembers, removeMember, setMemberEdit, sharedWith } from "./members";
import { migrate } from "./schema";
import { insertUser } from "./users";

let db: Db;
let trip: string;
const owner = "00000000-0000-4000-8000-000000000001";
const friend = "00000000-0000-4000-8000-000000000002";
const stranger = "00000000-0000-4000-8000-000000000003";

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  for (const [id, email] of [[owner, "neel@example.com"], [friend, "sam@example.com"], [stranger, "eve@example.com"]]) await insertUser(db, { id, email, passwordHash: "x", createdAt: 1 });
  trip = await upsertJourney(db, owner, { id: "00000000-0000-4000-8000-0000000000a1", title: "Tucson", destination: "Tucson", startDate: "2026-11-21", endDate: "2026-11-26", source: "manual", now: 1 });
});

describe("sharing a trip by email", () => {
  it("gives no access until the invite link is opened, then the invited role", async () => {
    const inv = await inviteMember(db, owner, trip, "Sam@Example.com", true, 1000);
    expect(inv?.member).toMatchObject({ email: "sam@example.com", canEdit: true, joined: false });
    expect(await accessFor(db, friend, trip)).toBeNull();
    expect(await acceptInvite(db, friend, inv!.token, 2000)).toEqual({ journeyId: trip });
    expect(await accessFor(db, friend, trip)).toEqual({ ownerId: owner, role: "editor" });
    expect(await accessFor(db, owner, trip)).toEqual({ ownerId: owner, role: "owner" });
    expect(await accessFor(db, stranger, trip)).toBeNull();
  });

  it("works once, and not after it expires", async () => {
    const inv = await inviteMember(db, owner, trip, "sam@example.com", false, 1000);
    await acceptInvite(db, friend, inv!.token, 2000);
    expect(await acceptInvite(db, stranger, inv!.token, 3000)).toBeNull();
    expect(await accessFor(db, stranger, trip)).toBeNull();
    const late = await inviteMember(db, owner, trip, "eve@example.com", false, 1000);
    expect(await acceptInvite(db, stranger, late!.token, 1000 + INVITE_TTL_MS + 1)).toBeNull();
  });

  it("lets only the owner invite, change or list people", async () => {
    expect(await inviteMember(db, friend, trip, "eve@example.com", true, 1)).toBeNull();
    const inv = await inviteMember(db, owner, trip, "sam@example.com", false, 1);
    expect(await setMemberEdit(db, friend, trip, inv!.member.id, true)).toBe(false);
    expect(await listMembers(db, friend, trip)).toBeNull();
    expect(await setMemberEdit(db, owner, trip, inv!.member.id, true)).toBe(true);
    expect((await listMembers(db, owner, trip))?.[0]).toMatchObject({ email: "sam@example.com", canEdit: true });
  });

  it("downgrades and removes access at once", async () => {
    const inv = await inviteMember(db, owner, trip, "sam@example.com", true, 1);
    await acceptInvite(db, friend, inv!.token, 2);
    await setMemberEdit(db, owner, trip, inv!.member.id, false);
    expect((await accessFor(db, friend, trip))?.role).toBe("viewer");
    expect(await removeMember(db, stranger, trip, inv!.member.id)).toBe(false);
    expect(await removeMember(db, owner, trip, inv!.member.id)).toBe(true);
    expect(await accessFor(db, friend, trip)).toBeNull();
    expect(await sharedWith(db, friend)).toEqual([]);
  });

  it("lets a member leave", async () => {
    const inv = await inviteMember(db, owner, trip, "sam@example.com", true, 1);
    await acceptInvite(db, friend, inv!.token, 2);
    expect(await leaveTrip(db, stranger, trip)).toBe(false);
    expect(await leaveTrip(db, friend, trip)).toBe(true);
    expect(await accessFor(db, friend, trip)).toBeNull();
  });

  it("lists trips shared with someone, by the owner's name", async () => {
    const inv = await inviteMember(db, owner, trip, "sam@example.com", false, 1);
    await acceptInvite(db, friend, inv!.token, 2);
    expect(await sharedWith(db, friend)).toEqual([{ journeyId: trip, ownerId: owner, role: "viewer", owner: "neel" }]);
  });

  it("finds the trip and owner behind an item", async () => {
    const item = await upsertItem(db, owner, { id: "00000000-0000-4000-8000-0000000000b1", journeyId: trip, source: "manual", dedupeKey: null, now: 1, item: { kind: "activity", status: "planned", title: "Hike", startDate: "2026-11-22", startTime: null, endDate: null, endTime: null, place: null, confirmation: null, details: {} } });
    expect(await childOf(db, "item", item)).toEqual({ journeyId: trip, ownerId: owner });
    expect(await childOf(db, "task", item)).toBeNull();
  });
});

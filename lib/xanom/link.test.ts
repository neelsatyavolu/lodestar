import { beforeEach, describe, expect, it } from "vitest";
import { issueReset, register, resetPassword, signIn } from "../account/accounts";
import { createPersonalToken, listGrants } from "../db/agent-auth";
import { createPgliteDb, type Db } from "../db/client";
import { getPreferences } from "../db/preferences";
import { migrate } from "../db/schema";
import { getUser, sessionVersionOf } from "../db/users";
import { insertIosTicket, takeIosTicket } from "../db/xanom";
import { linkXanom } from "./link";

let db: Db;
const NOW = Date.parse("2026-11-12T12:00:00Z");
const ada = { sub: "xa_ADA", email: "ada@example.com", name: "Ada Lovelace" };
const signin = { intent: "signin" as const, currentUserId: null, now: NOW };

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

describe("linking rules", () => {
  it("rule 4: creates a passwordless account with the sub, a verified email and the name", async () => {
    const r = await linkXanom(db, ada, signin);
    expect(r).toMatchObject({ ok: true, created: true });
    const user = await getUser(db, (r as { userId: string }).userId);
    expect(user).toMatchObject({ email: "ada@example.com", passwordHash: null, xanomSub: "xa_ADA", xanomEmail: "ada@example.com", emailVerified: true });
    expect((await getPreferences(db, user!.id)).displayName).toBe("Ada Lovelace");
    // No password to guess.
    expect(await signIn(db, { email: "ada@example.com", password: "" })).toBeNull();
  });

  it("rule 1: the same sub signs in to the same account, even after the Xanom email changes", async () => {
    const first = await linkXanom(db, ada, signin);
    const again = await linkXanom(db, { ...ada, email: "ada@new.example" }, signin);
    expect(again).toEqual({ ok: true, userId: (first as { userId: string }).userId, created: false });
    expect((await getUser(db, (first as { userId: string }).userId))!.xanomEmail).toBe("ada@new.example");
  });

  it("rule 2: link attaches the sub to the signed-in account, whatever its email", async () => {
    const me = (await register(db, { email: "sam@example.com", password: "correct horse", now: NOW }))!;
    const r = await linkXanom(db, ada, { intent: "link", currentUserId: me, now: NOW });
    expect(r).toEqual({ ok: true, userId: me, created: false });
    const user = await getUser(db, me);
    expect(user).toMatchObject({ xanomSub: "xa_ADA", xanomEmail: "ada@example.com", emailVerified: false });
    // The password still works: linking never removes the old login.
    expect(await signIn(db, { email: "sam@example.com", password: "correct horse" })).toBe(me);
  });

  it("rule 2: convert needs the same email, and verifies it", async () => {
    const me = (await register(db, { email: "ada@example.com", password: "correct horse", now: NOW }))!;
    expect(await linkXanom(db, { ...ada, email: "other@example.com" }, { intent: "convert", currentUserId: me, now: NOW })).toEqual({ ok: false, reason: "email_mismatch" });
    expect(await linkXanom(db, ada, { intent: "convert", currentUserId: me, now: NOW })).toEqual({ ok: true, userId: me, created: false });
    expect(await getUser(db, me)).toMatchObject({ xanomSub: "xa_ADA", emailVerified: true, passwordHash: expect.any(String) });
  });

  it("rule 2: refuses a sub already on another account, and never switches accounts", async () => {
    const other = (await linkXanom(db, ada, signin)) as { userId: string };
    const me = (await register(db, { email: "sam@example.com", password: "correct horse", now: NOW }))!;
    expect(await linkXanom(db, ada, { intent: "link", currentUserId: me, now: NOW })).toEqual({ ok: false, reason: "already_linked" });
    expect((await getUser(db, me))!.xanomSub).toBeNull();
    expect(other.userId).not.toBe(me);
  });

  it("rule 2: refuses a second Xanom account on an already linked account", async () => {
    const me = (await register(db, { email: "sam@example.com", password: "correct horse", now: NOW }))!;
    await linkXanom(db, ada, { intent: "link", currentUserId: me, now: NOW });
    expect(await linkXanom(db, { ...ada, sub: "xa_OTHER" }, { intent: "link", currentUserId: me, now: NOW })).toEqual({ ok: false, reason: "other_xanom" });
    // Linking the same one again is fine.
    expect(await linkXanom(db, ada, { intent: "link", currentUserId: me, now: NOW })).toEqual({ ok: true, userId: me, created: false });
  });

  it("rule 2 only applies to link/convert: a sign-in while signed in follows rules 1, 3 and 4", async () => {
    const me = (await register(db, { email: "sam@example.com", password: "correct horse", now: NOW }))!;
    const r = await linkXanom(db, ada, { intent: "signin", currentUserId: me, now: NOW });
    expect(r).toMatchObject({ ok: true, created: true });
    expect((await getUser(db, me))!.xanomSub).toBeNull();
  });

  it("rule 3 + guard: an unverified account with a password loses its password, sessions, agents and AI sign-ins", async () => {
    const squatter = (await register(db, { email: "ada@example.com", password: "attacker pass", now: NOW }))!;
    await createPersonalToken(db, squatter, "planted", NOW);
    await db.query("INSERT INTO ai_connections (user_id, provider, sealed, updated_at) VALUES ($1, 'codex', 'x', now())", [squatter]);
    const versionBefore = await sessionVersionOf(db, squatter);

    const r = await linkXanom(db, ada, signin);
    expect(r).toEqual({ ok: true, userId: squatter, created: false });
    const user = await getUser(db, squatter);
    expect(user).toMatchObject({ passwordHash: null, xanomSub: "xa_ADA", emailVerified: true });
    expect(await sessionVersionOf(db, squatter)).toBe(versionBefore! + 1);
    expect(await listGrants(db, squatter)).toEqual([]);
    expect(await db.query("SELECT 1 FROM ai_connections WHERE user_id = $1", [squatter])).toEqual([]);
    expect(await signIn(db, { email: "ada@example.com", password: "attacker pass" })).toBeNull();
  });

  it("rule 3 without the guard: an account whose email a reset proved keeps its password and sessions", async () => {
    const id = (await register(db, { email: "ada@example.com", password: "correct horse", now: NOW }))!;
    const token = await issueReset(db, id, NOW);
    await resetPassword(db, { token, password: "new correct horse", now: NOW });
    const version = await sessionVersionOf(db, id);

    expect(await linkXanom(db, ada, signin)).toEqual({ ok: true, userId: id, created: false });
    expect(await sessionVersionOf(db, id)).toBe(version);
    expect(await signIn(db, { email: "ada@example.com", password: "new correct horse" })).toBe(id);
  });

  it("rule 3: refuses an email whose account is linked to a different Xanom account", async () => {
    const me = (await register(db, { email: "ada@example.com", password: "correct horse", now: NOW }))!;
    await linkXanom(db, { ...ada, sub: "xa_FIRST", email: "first@example.com" }, { intent: "link", currentUserId: me, now: NOW });
    expect(await linkXanom(db, ada, signin)).toEqual({ ok: false, reason: "email_taken" });
  });

  it("refuses link/convert when the signed-in account no longer exists", async () => {
    expect(await linkXanom(db, ada, { intent: "link", currentUserId: "00000000-0000-4000-8000-000000000000", now: NOW })).toEqual({ ok: false, reason: "signed_out" });
  });
});

describe("iOS tickets", () => {
  const t = { ...ada, intent: "signin", userId: null, challenge: "c".repeat(43) };

  it("redeem once, before they expire", async () => {
    await insertIosTicket(db, "ticket-one-aaaaaaaaaaaa", t, NOW + 60_000);
    expect(await takeIosTicket(db, "ticket-one-aaaaaaaaaaaa", NOW)).toEqual(t);
    expect(await takeIosTicket(db, "ticket-one-aaaaaaaaaaaa", NOW)).toBeNull();

    await insertIosTicket(db, "ticket-two-aaaaaaaaaaaa", t, NOW + 60_000);
    expect(await takeIosTicket(db, "ticket-two-aaaaaaaaaaaa", NOW + 60_001)).toBeNull();
    expect(await takeIosTicket(db, "never-issued-aaaaaaaaaa", NOW)).toBeNull();
  });
});

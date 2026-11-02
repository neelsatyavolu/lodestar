import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "../db/client";
import { migrate } from "../db/schema";
import { deleteUser, endSessions, getUser } from "../db/users";
import { hitRateLimit } from "../db/rate-limit";
import { accountIn, issueReset, register, resetPassword, RESET_TTL_MS, signIn } from "./accounts";
import { createSession, sessionKey } from "./session";

const key = sessionKey("a-long-enough-test-secret");
let db: Db;

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

describe("accounts", () => {
  it("registers once per email and signs in with the right password only", async () => {
    const id = await register(db, { email: "ada@example.com", password: "correct horse", now: 1 });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await register(db, { email: "ada@example.com", password: "other password", now: 2 })).toBeNull();
    expect(await signIn(db, { email: "ada@example.com", password: "correct horse" })).toBe(id);
    expect(await signIn(db, { email: "ada@example.com", password: "wrong horse" })).toBeNull();
    expect(await signIn(db, { email: "nobody@example.com", password: "correct horse" })).toBeNull();
  });

  it("honours a session until its account ends sessions or is deleted", async () => {
    const id = (await register(db, { email: "ada@example.com", password: "correct horse", now: 1 }))!;
    const token = createSession(key, id, 1000, 0);
    expect(await accountIn(db, key, token, 2000)).toBe(id);
    await endSessions(db, id);
    expect(await accountIn(db, key, token, 2000)).toBeNull();
    expect(await accountIn(db, key, createSession(key, id, 1000, 1), 2000)).toBe(id);
    await deleteUser(db, id);
    expect(await accountIn(db, key, createSession(key, id, 1000, 1), 2000)).toBeNull();
  });

  it("resets a password once with a live token and ends old sessions", async () => {
    const id = (await register(db, { email: "ada@example.com", password: "correct horse", now: 1 }))!;
    const old = createSession(key, id, 1000, 0);
    const token = await issueReset(db, id, 1000);
    expect(await resetPassword(db, { token: "wrong", password: "new password!", now: 2000 })).toBeNull();
    expect(await resetPassword(db, { token, password: "new password!", now: 2000 })).toBe(id);
    expect(await resetPassword(db, { token, password: "again password", now: 2001 })).toBeNull();
    expect(await signIn(db, { email: "ada@example.com", password: "new password!" })).toBe(id);
    expect(await accountIn(db, key, old, 3000)).toBeNull();
  });

  it("rejects an expired reset token and keeps only the newest", async () => {
    const id = (await register(db, { email: "ada@example.com", password: "correct horse", now: 1 }))!;
    const first = await issueReset(db, id, 1000);
    const second = await issueReset(db, id, 1000);
    expect(await resetPassword(db, { token: first, password: "new password!", now: 2000 })).toBeNull();
    expect(await resetPassword(db, { token: second, password: "new password!", now: 1000 + RESET_TTL_MS })).toBeNull();
  });

  it("deleting a user removes their record", async () => {
    const id = (await register(db, { email: "ada@example.com", password: "correct horse", now: 1 }))!;
    await deleteUser(db, id);
    expect(await getUser(db, id)).toBeNull();
  });
});

it("rate limits per window", async () => {
  db = await createPgliteDb();
  await migrate(db);
  const hits = [];
  for (let i = 0; i < 4; i++) hits.push(await hitRateLimit(db, "k", 3, 1000, 5000));
  expect(hits).toEqual([true, true, true, false]);
  expect(await hitRateLimit(db, "k", 3, 1000, 7000)).toBe(true);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb, type Db } from "../db/client";
import { migrate } from "../db/schema";
import { getAiConnection } from "../db/ai-connections";
import { insertUser } from "../db/users";

// A fake cookie jar and signed-in user stand in for the request; the database is real (PGlite).
const jar = new Map<string, string>();
const state: { db: Db | null; userId: string | null } = { db: null, userId: null };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: ({ name }: { name: string }) => void jar.delete(name),
  }),
}));
vi.mock("../server/auth", () => ({ currentUserId: async () => state.userId }));
vi.mock("../db/client", async (original) => ({ ...(await original<typeof import("../db/client")>()), getDb: async () => state.db! }));

const { aiOwner, clearAiSessions, clearSession, getActiveSession, hasSession, writeSession } = await import("./session");

const userId = "00000000-0000-4000-8000-000000000001";
const tokens = { accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000 };
const sessionCookies = () => [...jar.keys()].filter((k) => k.startsWith("codex_s_"));

beforeEach(async () => {
  process.env.LODESTAR_SECRET = "a-long-enough-test-secret";
  jar.clear();
  state.db = await createPgliteDb();
  await migrate(state.db);
  await insertUser(state.db, { id: userId, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
  state.userId = null;
});

describe("AI session ownership", () => {
  it("keeps a signed-out connection in this browser's cookies only", async () => {
    const owner = await aiOwner();
    expect(owner.kind).toBe("device");
    await writeSession("codex", owner, tokens);
    expect(sessionCookies().length).toBeGreaterThan(0);
    expect(await getAiConnection(state.db!, userId, "codex")).toBeNull();
    expect(await hasSession("codex", owner)).toBe(true);
  });

  it("saves a signed-in connection to the account, and it survives sign-out", async () => {
    state.userId = userId;
    const owner = await aiOwner();
    expect(owner).toEqual({ kind: "user", id: userId });
    await writeSession("codex", owner, tokens);
    expect(sessionCookies()).toEqual([]);
    expect(await getAiConnection(state.db!, userId, "codex")).toMatch(/^v1\./);

    await clearAiSessions(); // account sign-out
    state.userId = null;
    expect(await hasSession("codex", await aiOwner())).toBe(false);

    state.userId = userId; // sign back in, on any browser
    expect((await getActiveSession("codex", await aiOwner()))?.accessToken).toBe("access");
  });

  it("moves a browser's connection into the account on first use after signing in", async () => {
    await writeSession("codex", await aiOwner(), tokens);
    state.userId = userId;
    expect(await hasSession("codex", await aiOwner())).toBe(true);
    expect(sessionCookies()).toEqual([]);
    expect(await getAiConnection(state.db!, userId, "codex")).toMatch(/^v1\./);
  });

  it("disconnecting while signed in removes the saved connection", async () => {
    state.userId = userId;
    const owner = await aiOwner();
    await writeSession("codex", owner, tokens);
    await clearSession("codex", owner);
    expect(await getAiConnection(state.db!, userId, "codex")).toBeNull();
    expect(await hasSession("codex", owner)).toBe(false);
  });

  it("does not open another account's saved connection", async () => {
    const otherId = "00000000-0000-4000-8000-000000000002";
    await insertUser(state.db!, { id: otherId, email: "bob@example.com", passwordHash: "x", createdAt: 1 });
    state.userId = userId;
    await writeSession("codex", await aiOwner(), tokens);
    const sealed = (await getAiConnection(state.db!, userId, "codex"))!;
    await state.db!.query("INSERT INTO ai_connections (user_id, provider, sealed, updated_at) VALUES ($1, 'codex', $2, now())", [otherId, sealed]);
    expect(await hasSession("codex", { kind: "user", id: otherId })).toBe(false);
  });
});

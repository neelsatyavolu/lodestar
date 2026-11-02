import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "./client";
import { migrate } from "./schema";
import { deleteAiConnection, getAiConnection, saveAiConnection } from "./ai-connections";
import { deleteUser, insertUser } from "./users";

let db: Db;
const userId = "00000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await insertUser(db, { id: userId, email: "ada@example.com", passwordHash: "x", createdAt: 1 });
});

describe("ai connections", () => {
  it("saves, replaces and deletes one sealed session per provider", async () => {
    expect(await getAiConnection(db, userId, "codex")).toBeNull();
    await saveAiConnection(db, userId, "codex", "v1.first", 1);
    await saveAiConnection(db, userId, "codex", "v1.second", 2);
    await saveAiConnection(db, userId, "grok", "v1.grok", 3);
    expect(await getAiConnection(db, userId, "codex")).toBe("v1.second");
    expect(await getAiConnection(db, userId, "grok")).toBe("v1.grok");
    await deleteAiConnection(db, userId, "codex");
    expect(await getAiConnection(db, userId, "codex")).toBeNull();
    expect(await getAiConnection(db, userId, "grok")).toBe("v1.grok");
  });

  it("goes away with the account", async () => {
    await saveAiConnection(db, userId, "codex", "v1.sealed", 1);
    await deleteUser(db, userId);
    expect(await getAiConnection(db, userId, "codex")).toBeNull();
  });
});

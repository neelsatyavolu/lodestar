import { z } from "zod";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { countGrants, createPersonalToken, listGrants, MAX_GRANTS } from "@/lib/db/agent-auth";
import { resourceUrl } from "@/lib/oauth/metadata";
import { currentUserId } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { allow } from "@/lib/server/limits";

const TokenName = z.object({ name: z.string().trim().min(1, "Name the token, like Codex on my laptop.").max(60) });

// GET /api/agents: the MCP address, apps connected over OAuth and personal tokens.
export function GET(req: Request) {
  return handle(req, "agent list", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    return ok({ mcpUrl: resourceUrl(env().APP_URL), grants: await listGrants(await getDb(), userId) });
  });
}

// POST /api/agents {name}: a personal token for a CLI or script. It's in this response only.
export function POST(req: Request) {
  return handle(req, "token create", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    if (!(await allow("agentTokens", userId))) return fail("Too many new tokens. Try again later.", 429);
    const { name } = TokenName.parse(await readJson(req, 1_000));
    const db = await getDb();
    if ((await countGrants(db, userId)) >= MAX_GRANTS) return fail(`You can have ${MAX_GRANTS} connections. Revoke one first.`, 409);
    const { grant, token } = await createPersonalToken(db, userId, name, Date.now());
    return ok({ grant, token }, { headers: { "cache-control": "no-store" } });
  });
}

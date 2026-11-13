import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { getDb } from "../db/client";
import { tokenOwner } from "../db/agent-auth";
import { allow } from "../server/limits";
import { runTool, TOOLS } from "./tools";

// Registers the Trips tools on an MCP server. The account comes from the
// bearer token, verified by withMcpAuth before any tool runs.

export const INSTRUCTIONS = `Lodestar Trips holds the traveller's trips: an itinerary by day with a map, what still needs booking, bookings, a budget, a checklist, a packing list and notes. Use list_trips and get_trip to read, and get_preferences for the traveller's food taste and home airports; the create/add/update tools to plan. Build complete plans: times on items, reserve + bookBy on anything that needs a reservation, estimates for costs, a checklist, a packing list (add_packing_items) and a short "How the trip works" note. Ask before deleting anything.`;

const failure = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export function registerTripTools(server: McpServer): void {
  for (const def of TOOLS) {
    server.registerTool(def.name, { title: def.title, description: def.description, inputSchema: def.input, annotations: { title: def.title, openWorldHint: false, ...def.annotations } }, async (args: unknown, ctx) => {
      const userId = ctx.http?.authInfo?.extra?.userId;
      const grantId = ctx.http?.authInfo?.extra?.grantId;
      if (typeof userId !== "string" || typeof grantId !== "string") return failure("Not signed in to Lodestar.");
      if (!(await allow("mcp", grantId))) return failure("Too many requests. Wait a few minutes and try again.");
      const out = await runTool(def, { db: await getDb(), userId, today: new Date().toISOString().slice(0, 10) }, args);
      if (!out.ok) return failure(out.message);
      return { content: [{ type: "text" as const, text: out.result.text }], ...(out.result.data ? { structuredContent: out.result.data } : {}) };
    });
  }
}

/** withMcpAuth's verifier: an access or personal token of ours that's still good, as the SDK's AuthInfo. */
export async function verifyBearer(_req: Request, token?: string) {
  if (!token) return undefined;
  const owner = await tokenOwner(await getDb(), token, Date.now());
  if (!owner) return undefined;
  return {
    token,
    clientId: owner.clientId,
    scopes: ["trips"],
    ...(owner.expiresAt !== null ? { expiresAt: Math.floor(owner.expiresAt / 1000) } : {}),
    extra: { userId: owner.userId, grantId: owner.grantId },
  };
}

import { connection } from "next/server";
import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { listLinks } from "@/lib/db/inbound";
import { currentUserId } from "@/lib/server/auth";
import { forwardingAddress } from "@/lib/server/journeys";

// GET /api/connectors: the account's forwarding address (null when inbound mail isn't set up) and its Flint connections.
export async function GET(req: Request) {
  // Per request, never prerendered: otherwise the build logs handle()'s catch of the prerender signal.
  await connection();
  return handle(req, "connections", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    const db = await getDb();
    return ok({ address: await forwardingAddress(db, userId), flint: await listLinks(db, userId) });
  });
}

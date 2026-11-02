import { fail, handle, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { forwardingAddress } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";

// POST /api/connectors/address: a new forwarding address. The old one stops working.
export function POST(req: Request) {
  return handle(req, "address change", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    if (!(await allow("journeys", ipKey(req)))) return fail("Too many changes. Try again in a few minutes.", 429);
    const address = await forwardingAddress(await getDb(), userId, true);
    return address ? ok({ address }) : fail("Forwarding isn't set up on this server.", 404);
  });
}

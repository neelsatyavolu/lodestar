import { fail, handle, ok } from "@/lib/api";
import { hashCode, newPairCode, PAIR_CODE_TTL_MS } from "@/lib/connectors/flint";
import { getDb } from "@/lib/db/client";
import { insertPairCode } from "@/lib/db/inbound";
import { currentUserId } from "@/lib/server/auth";
import { pairPepper, senderKey } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";

// POST /api/connectors/flint/code: a one-time code to type into Flint. A new code replaces the last one.
export function POST(req: Request) {
  return handle(req, "pairing code", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    if (!(await allow("pairCode", senderKey("user", userId)))) return fail("Too many codes. Try again in a few minutes.", 429);
    const code = newPairCode();
    const expiresAt = Date.now() + PAIR_CODE_TTL_MS;
    await insertPairCode(await getDb(), userId, hashCode(pairPepper(), code), expiresAt);
    return ok({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt });
  });
}

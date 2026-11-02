import { fail, ok } from "@/lib/api";
import { hashCode, PairSchema } from "@/lib/connectors/flint";
import { getDb } from "@/lib/db/client";
import { insertLink, takePairCode } from "@/lib/db/inbound";
import { ipKey } from "@/lib/server/auth";
import { machineHandle, rawBody } from "@/lib/server/connector-request";
import { pairPepper, sealConnectorSecret } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";

// POST /api/connectors/flint/pair {code, connectionId, secret, deviceName}: Flint finishes pairing.
// The one-time code proves which signed-in account approved it; the secret signs every delivery after.
export function POST(req: Request) {
  return machineHandle("pairing", async () => {
    if (!(await allow("pair", ipKey(req)))) return fail("Too many attempts. Try again in a few minutes.", 429);
    const text = await rawBody(req, 8_000);
    if (text === null) return fail("Request is too large.", 413);
    const input = PairSchema.parse(JSON.parse(text));
    const db = await getDb();
    const userId = await takePairCode(db, hashCode(pairPepper(), input.code), Date.now());
    if (!userId) return fail("That code is wrong or expired. Get a new one in Lodestar.", 400);
    const created = await insertLink(db, userId, { id: input.connectionId, sealedSecret: sealConnectorSecret(input.connectionId, input.secret), deviceName: input.deviceName, now: Date.now() });
    return created ? ok({ connected: true }) : fail("That connection already exists.", 409);
  });
}

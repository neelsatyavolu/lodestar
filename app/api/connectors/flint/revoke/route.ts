import { fail, ok } from "@/lib/api";
import { RevokeSchema } from "@/lib/connectors/flint";
import { getDb } from "@/lib/db/client";
import { deleteLink } from "@/lib/db/inbound";
import { machineHandle, rawBody, signedConnection } from "@/lib/server/connector-request";

// POST /api/connectors/flint/revoke {connectionId}: the traveller removed Lodestar in Flint.
export function POST(req: Request) {
  return machineHandle("disconnect", async () => {
    const body = (await rawBody(req, 2_000)) ?? "";
    const who = await signedConnection(req, body);
    if (who instanceof Response) return who;
    // A signed delivery replayed here has no matching connectionId, so it can't disconnect anything.
    const input = RevokeSchema.safeParse(JSON.parse(body || "null"));
    if (!input.success || input.data.connectionId !== who.connectionId) return fail("Not a revoke request.", 400);
    await deleteLink(await getDb(), who.connectionId);
    return ok({});
  });
}

import "server-only";
import { z } from "zod";
import { fail, fromError } from "../api";
import { verifyDelivery } from "../connectors/flint";
import { getDb } from "../db/client";
import { linkSecret } from "../db/inbound";
import { openConnectorSecret } from "./journeys";

// Requests from Flint arrive from a desktop app, not a browser: no session and
// no Origin. They are authenticated by the connection's HMAC signature instead.

export const MAX_DELIVERY_BYTES = 1_500_000;

export async function rawBody(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const text = await req.text();
  return text.length > max ? null : text;
}

/** The account a signed Flint request belongs to, or the response to send. 401 tells Flint to stop the connection. */
export async function signedConnection(req: Request, body: string): Promise<{ userId: string; connectionId: string } | Response> {
  const connectionId = z.uuid().safeParse(req.headers.get("x-flint-connection"));
  if (!connectionId.success) return fail("Unknown connection.", 401);
  const link = await linkSecret(await getDb(), connectionId.data);
  const secret = link ? openConnectorSecret(connectionId.data, link.sealedSecret) : null;
  if (!link || !secret) return fail("Unknown connection.", 401);
  const valid = verifyDelivery({ secret, timestamp: req.headers.get("x-flint-timestamp"), signature: req.headers.get("x-flint-signature"), body, now: Date.now() });
  return valid ? { userId: link.userId, connectionId: connectionId.data } : fail("Bad signature.", 401);
}

export async function machineHandle(what: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SyntaxError) return fail("Request body is not JSON.", 400);
    return fromError(err, what);
  }
}

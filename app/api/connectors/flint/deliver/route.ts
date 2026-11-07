import { fail, ok } from "@/lib/api";
import { DeliverySchema } from "@/lib/connectors/flint";
import { getDb } from "@/lib/db/client";
import { touchLink } from "@/lib/db/inbound";
import { ingestMail } from "@/lib/journeys/ingest";
import { machineHandle, MAX_DELIVERY_BYTES, rawBody, signedConnection } from "@/lib/server/connector-request";
import { senderKey } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";

/** Flint's date as milliseconds: an ISO or RFC 2822 string, or a timestamp in seconds or milliseconds. */
function sentAt(date: string | number | undefined): number | undefined {
  const t = typeof date === "number" ? (date < 1e12 ? date * 1000 : date) : date ? Date.parse(date) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

// POST /api/connectors/flint/deliver: one message Flint matched against the approved manifest.
// Signed with the connection's secret; the same Message-ID is filed once however often it arrives.
export function POST(req: Request) {
  return machineHandle("delivery", async () => {
    const body = await rawBody(req, MAX_DELIVERY_BYTES);
    if (body === null) return fail("Message is too large.", 413);
    const who = await signedConnection(req, body);
    if (who instanceof Response) return who;
    if (!(await allow("inboundMail", senderKey("flint", who.connectionId)))) return fail("Too many messages today.", 429);
    const m = DeliverySchema.parse(JSON.parse(body));
    const db = await getDb();
    const result = await ingestMail(db, who.userId, { source: "flint", messageId: m.messageId, from: m.from, subject: m.subject, html: m.html ?? null, text: m.text ?? null, sentAt: sentAt(m.date) }, Date.now());
    await touchLink(db, who.connectionId, Date.now());
    return ok({ status: result.status });
  });
}

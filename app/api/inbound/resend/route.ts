import { fail, ok } from "@/lib/api";
import { fetchReceived, ReceivedEventSchema, tokenFromRecipients, verifySvix } from "@/lib/connectors/resend";
import { getDb } from "@/lib/db/client";
import { userForInbox } from "@/lib/db/inbound";
import { ingestMail } from "@/lib/journeys/ingest";
import { machineHandle, rawBody } from "@/lib/server/connector-request";
import { env } from "@/lib/server/env";
import { senderKey } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";

// POST /api/inbound/resend: Resend Inbound's "email.received" webhook for forwarded confirmations.
// Mail to an unknown address is acknowledged and dropped, so Resend doesn't retry it.
export function POST(req: Request) {
  return machineHandle("inbound email", async () => {
    const config = env();
    if (!config.RESEND_WEBHOOK_SECRET || !config.INBOUND_DOMAIN || !config.RESEND_API_KEY) return fail("Inbound mail isn't set up.", 404);
    const body = await rawBody(req, 200_000);
    if (body === null) return fail("Request is too large.", 413);
    const signed = verifySvix({ secret: config.RESEND_WEBHOOK_SECRET, id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"), body, now: Date.now() });
    if (!signed) return fail("Bad signature.", 401);
    const event = ReceivedEventSchema.parse(JSON.parse(body));
    if (event.type !== "email.received") return ok({ ignored: true });

    const db = await getDb();
    const token = tokenFromRecipients(event.data.to, config.INBOUND_DOMAIN);
    const userId = token ? await userForInbox(db, token) : null;
    if (!userId || !token) return ok({ ignored: true });
    if (!(await allow("inboundMail", senderKey("inbox", token)))) return ok({ ignored: true, reason: "daily limit" });

    const mail = await fetchReceived(event.data.email_id, config.RESEND_API_KEY);
    const result = await ingestMail(db, userId, { source: "forward", messageId: mail.message_id ?? `resend:${mail.id}`, from: mail.from, subject: mail.subject ?? "", html: mail.html, text: mail.text }, Date.now());
    return ok({ status: result.status });
  });
}

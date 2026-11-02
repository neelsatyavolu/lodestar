import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Forwarded mail arrives through Resend Inbound: a webhook (signed the Svix
// way) says an email came in, and its content is fetched from Resend's API.

export const SVIX_WINDOW_S = 5 * 60;

/** Svix: base64 HMAC-SHA256 of "id.timestamp.body" with the secret after "whsec_"; the header may hold several "v1,<sig>". */
export function verifySvix(p: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now: number }): boolean {
  if (!p.id || !p.timestamp || !p.signature || !/^\d{9,11}$/.test(p.timestamp)) return false;
  if (Math.abs(p.now / 1000 - Number(p.timestamp)) > SVIX_WINDOW_S) return false;
  const key = Buffer.from(p.secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(createHmac("sha256", key).update(`${p.id}.${p.timestamp}.${p.body}`).digest("base64"));
  return p.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export const INBOX_TOKEN = /^[a-z0-9]{20,40}$/;

/** The account token from the address it was sent to, when it's on our inbound domain. */
export function tokenFromRecipients(recipients: string[], domain: string): string | null {
  for (const r of recipients) {
    const address = (r.match(/<([^>]+)>/)?.[1] ?? r).trim().toLowerCase();
    const [local, host] = address.split("@");
    // Plus-addressing is fine: "token+anything@domain".
    const token = local?.split("+")[0];
    if (host === domain.toLowerCase() && token && INBOX_TOKEN.test(token)) return token;
  }
  return null;
}

export const ReceivedEventSchema = z.object({
  type: z.string(),
  data: z.looseObject({ email_id: z.string().min(1).max(100), to: z.array(z.string()).max(50).default([]), from: z.string().max(400).default(""), subject: z.string().max(1000).default("") }),
});

const ReceivedEmailSchema = z.object({
  id: z.string(),
  from: z.string().default(""),
  subject: z.string().nullable().default(""),
  html: z.string().nullable().default(null),
  text: z.string().nullable().default(null),
  message_id: z.string().nullable().default(null),
  to: z.array(z.string()).default([]),
  received_for: z.array(z.string()).default([]),
});
export type ReceivedEmail = z.infer<typeof ReceivedEmailSchema>;

/** The full message from Resend. Inline images stay as cid: references so the body stays small. */
export async function fetchReceived(id: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<ReceivedEmail> {
  const res = await fetcher(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned HTTP ${res.status} for a received email.`);
  return ReceivedEmailSchema.parse(await res.json());
}

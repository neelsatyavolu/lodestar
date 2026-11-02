import { money } from "../format";
import { sendEmail } from "../mail/send";
import { renderEmail, type RenderedEmail } from "../mail/template";
import type { AlertReason } from "./alerts";

// The one email a saved trip's daily check sends, whatever fired it.

const FROM = "Lodestar <no-reply@n3el.dev>";

export type TripAlert = { title: string; reasons: AlertReason[]; cheapest: number | null; previous: number; target: number | null; url: string };

export function tripAlertEmail(a: TripAlert): RenderedEmail {
  const now = a.cheapest !== null ? money(a.cheapest) : null;
  const lines: string[] = [];
  if (a.reasons.includes("drop") && now) lines.push(`The best fare fell to ${now}, down from ${money(a.previous)}.`);
  if (a.reasons.includes("target") && now && a.target !== null) lines.push(`That's at or under your ${money(a.target)} target.`);
  if (a.reasons.includes("remind")) lines.push(now ? `You asked for a reminder to book. The best fare right now is ${now}.` : "You asked for a reminder to book. Open the trip to check today's fares.");
  const subject = a.reasons.includes("remind") && a.reasons.length === 1 ? `Reminder: book ${a.title}` : `${now ?? "Fare update"}: ${a.title}`;
  return renderEmail({
    subject,
    heading: a.title,
    body: lines.join(" "),
    button: "Open the trip",
    url: a.url,
    linkHint: "Or paste this link into your browser:",
    footer: "You get this because you set alerts on this saved trip. Turn them off in Trips. Fares change quickly; check the price before you book.",
  });
}

export function tripLink(appUrl: string, id: string): string {
  const url = new URL("/", appUrl);
  url.searchParams.set("trip", id);
  return url.toString();
}

/** Without a Resend key (local development only) the alert goes to the server console. */
export async function sendTripAlert(to: string, alert: TripAlert, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<void> {
  const mail = tripAlertEmail(alert);
  if (!apiKey) {
    console.info(`[lodestar] no RESEND_API_KEY, so this trip alert is printed instead of emailed: ${mail.subject} — ${alert.url}`);
    return;
  }
  await sendEmail({ to, ...mail }, { apiKey, from: FROM }, fetchImpl);
}

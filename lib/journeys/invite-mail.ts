import "server-only";
import { sendEmail } from "../mail/send";
import { renderEmail, type RenderedEmail } from "../mail/template";

// The email that invites someone to a trip. Its link carries the one-time
// token; opening it signed in joins the trip.

const FROM = "Lodestar <no-reply@n3el.dev>";

/** Built on the configured site address, never the request's Host header. */
export function inviteLink(appUrl: string, token: string): string {
  const url = new URL("/", appUrl);
  url.searchParams.set("invite", token);
  return url.toString();
}

export function inviteEmail(from: string, trip: string, canEdit: boolean, url: string): RenderedEmail {
  return renderEmail({
    subject: `${from} shared ${trip} with you`,
    heading: `${trip} on Lodestar`,
    body: canEdit
      ? `${from} invited you to plan ${trip} together. You'll see the whole itinerary, bookings and budget, and can change them.`
      : `${from} invited you to see ${trip}: the itinerary, flights, hotels and checklist.`,
    button: "Open the trip",
    url,
    linkHint: "Or paste this link into your browser:",
    footer: "Sign in or create a Lodestar account to open it. The link works once and expires in 14 days. If you weren't expecting it, ignore this email.",
  });
}

/** Without a Resend key (local development only) the link goes to the server console. */
export async function sendInvite(to: string, mail: RenderedEmail, url: string, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!apiKey) {
    console.info(`[lodestar] no RESEND_API_KEY, so the invite link is printed instead of emailed: ${url}`);
    return;
  }
  await sendEmail({ to, ...mail }, { apiKey, from: FROM }, fetchImpl);
}

import "server-only";
import { sendEmail } from "../mail/send";
import { renderEmail, type RenderedEmail } from "../mail/template";

// n3el.dev is the domain verified in Resend.
const FROM = "Lodestar <no-reply@n3el.dev>";
const RESET_PATH = "/reset";

/**
 * The page that sets a new password. Built on the configured site address,
 * never the request's Host header, which a requester could point elsewhere.
 */
export function resetLink(appUrl: string, token: string): string {
  const url = new URL(RESET_PATH, appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function resetEmail(url: string): RenderedEmail {
  return renderEmail({
    subject: "Reset your Lodestar password",
    heading: "Reset your password",
    body: "Someone asked to reset the password for your Lodestar account. If that was you, choose a new one below.",
    button: "Choose a new password",
    url,
    linkHint: "Or paste this link into your browser:",
    footer: "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email and your password stays the same.",
  });
}

/** Emails a reset link. Without a Resend key (local development only) the link goes to the server console. */
export async function sendResetLink(to: string, url: string, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!apiKey) {
    console.info(`[lodestar] no RESEND_API_KEY, so the reset link is printed instead of emailed: ${url}`);
    return;
  }
  await sendEmail({ to, ...resetEmail(url) }, { apiKey, from: FROM }, fetchImpl);
}

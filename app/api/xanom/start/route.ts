import { safeReturnPath } from "@/lib/account/return-path";
import { getDb } from "@/lib/db/client";
import { getPreferences } from "@/lib/db/preferences";
import { getUser } from "@/lib/db/users";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { appUrl, failRedirect, goTo, writeFlow, xanomConfig, xanomKey } from "@/lib/server/xanom";
import { authorizeUrl, convertTicket } from "@/lib/xanom/oidc";
import { INTENTS, newFlow, openIosStart, validChallenge, type Intent, type Platform } from "@/lib/xanom/state";

// GET /api/xanom/start?intent=signin|link|convert&return=<path>&platform=web|ios
// Starts a Xanom sign-in: remembers state, PKCE and nonce in a signed cookie and sends the
// browser to accounts.xanom.co. iOS adds ios_challenge (sign-in) or as=<token from
// POST /api/xanom/ios-start> (link and convert), because its sheet doesn't carry the app's session.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const platform: Platform = url.searchParams.get("platform") === "ios" ? "ios" : "web";
  const config = xanomConfig();
  if (!config) return failRedirect("unavailable", platform);
  if (!(await allow("xanomStart", ipKey(req)))) return failRedirect("too_many", platform);

  const asked = url.searchParams.get("intent") ?? "signin";
  const intent: Intent = (INTENTS as readonly string[]).includes(asked) ? (asked as Intent) : "signin";
  const now = Date.now();
  let userId: string | null = null;
  let challenge: string | null = null;

  if (platform === "ios") {
    if (intent === "signin") {
      challenge = url.searchParams.get("ios_challenge");
      if (!validChallenge(challenge)) return failRedirect("expired", platform);
    } else {
      const start = openIosStart(xanomKey(), url.searchParams.get("as") ?? undefined, now);
      if (!start || start.intent !== intent) return failRedirect("expired", platform);
      userId = start.userId;
      challenge = start.challenge;
    }
  } else if (intent !== "signin") {
    userId = await currentUserId();
    if (!userId) return failRedirect("signed_out", platform);
  }

  let convert: string | null = null;
  if (intent === "convert" && userId) {
    const db = await getDb();
    const user = await getUser(db, userId);
    if (!user) return failRedirect("signed_out", platform);
    if (user.xanomSub) return failRedirect("other_xanom", platform);
    const prefs = await getPreferences(db, userId);
    convert = await convertTicket(config, { email: user.email, name: prefs.displayName, emailVerified: user.emailVerified }, now);
  }

  const origin = new URL(appUrl()).origin;
  const returnTo = safeReturnPath(url.searchParams.get("return"), origin) ?? "/";
  const flow = newFlow({ intent, platform, returnTo, userId, challenge }, now);
  await writeFlow(flow);
  return goTo(authorizeUrl(config, appUrl(), flow, convert));
}

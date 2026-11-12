import { getDb } from "@/lib/db/client";
import { insertIosTicket } from "@/lib/db/xanom";
import { currentUserId, ipKey, startSession } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { appUrl, clearFlow, failRedirect, goTo, IOS_CALLBACK, readFlowCookie, xanomConfig, xanomKey } from "@/lib/server/xanom";
import { finishCallback } from "@/lib/xanom/callback";
import { linkXanom } from "@/lib/xanom/link";
import { remoteJwks } from "@/lib/xanom/oidc";
import { openFlow, randomToken } from "@/lib/xanom/state";

const IOS_TICKET_TTL_MS = 60_000;

// GET /api/xanom/callback: accounts.xanom.co sends the browser back here with a code.
// The web signs in (or links) here; iOS gets a one-time ticket and finishes in the app.
export async function GET(req: Request) {
  const now = Date.now();
  const flow = openFlow(xanomKey(), await readFlowCookie(), now);
  await clearFlow();
  const platform = flow?.platform ?? "web";
  const config = xanomConfig();
  if (!config) return failRedirect("unavailable", platform);
  if (!(await allow("xanomCallback", ipKey(req)))) return failRedirect("too_many", platform);

  const result = await finishCallback({ config, appUrl: appUrl(), params: new URL(req.url).searchParams, flow, jwks: remoteJwks(config.issuer), now });
  if (!result.ok) {
    if (result.reason === "failed") console.error("[xanom] callback failed:", result.detail);
    return failRedirect(result.reason, platform);
  }
  const { identity } = result;
  const db = await getDb();

  if (flow!.platform === "ios") {
    // Linking waits for the app's exchange, which carries the app's own session.
    const ticket = randomToken();
    await insertIosTicket(db, ticket, { ...identity, intent: flow!.intent, userId: flow!.userId, challenge: flow!.challenge ?? "" }, now + IOS_TICKET_TTL_MS);
    return goTo(`${IOS_CALLBACK}?ticket=${ticket}`);
  }

  let signedIn: string | null = null;
  if (flow!.intent !== "signin") {
    signedIn = await currentUserId();
    // Linking is for the account that asked; a different (or no) session can't take it over.
    if (!signedIn || signedIn !== flow!.userId) return failRedirect("signed_out", "web");
  }
  const linked = await linkXanom(db, identity, { intent: flow!.intent, currentUserId: signedIn, now });
  if (!linked.ok) return failRedirect(linked.reason, "web");
  await startSession(linked.userId);
  const target = new URL(flow!.returnTo, appUrl());
  // Only the home page reads these; a return to another page (an OAuth consent screen) goes back as it was.
  if (target.pathname === "/" && linked.created) target.searchParams.set("xanom", "welcome");
  else if (target.pathname === "/" && flow!.intent !== "signin") target.searchParams.set("xanom", "linked");
  return goTo(target.toString());
}

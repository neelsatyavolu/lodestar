import { NextResponse } from "next/server";
import { fail, sameOrigin } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { issueCode } from "@/lib/db/agent-auth";
import { backToClient, checkAuthorize, PARAM_KEYS, single } from "@/lib/oauth/authorize";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { allow } from "@/lib/server/limits";

// POST /api/oauth/authorize: the consent page's Allow or Deny. Only this site
// can send it (Origin check, and the lax session cookie isn't sent cross-site).
// Allow issues a 10-minute single-use code; both answers redirect to the app.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused.", 403);
  const userId = await currentUserId();
  if (!userId) return fail("Sign in to Lodestar first.", 401);
  if (!(await allow("oauthAuthorize", ipKey(req)))) return fail("Too many requests. Try again in a few minutes.", 429);
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Send the consent form.", 400);
  const origin = env().APP_URL;
  const db = await getDb();
  const now = Date.now();
  const params = single((k) => form.getAll(k).map(String), PARAM_KEYS);
  const checked = await checkAuthorize(db, params, origin, now);
  if (checked.kind === "show") return fail(checked.message, 400);
  if (checked.kind === "redirect") return NextResponse.redirect(checked.url, 303);
  const { request } = checked;
  if (form.get("decision") !== "allow") return NextResponse.redirect(backToClient(request.redirectUri, { error: "access_denied", error_description: "The traveller declined.", state: request.state }, origin), 303);
  const code = await issueCode(db, { userId, clientId: request.client.id, redirectUri: request.redirectUri, challenge: request.challenge, resource: request.resource }, now);
  return NextResponse.redirect(backToClient(request.redirectUri, { code, state: request.state }, origin), 303);
}

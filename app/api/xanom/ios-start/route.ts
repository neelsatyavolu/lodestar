import { z } from "zod";
import { fail, handle, ok, readJson } from "@/lib/api";
import { currentUserId } from "@/lib/server/auth";
import { appUrl, xanomConfig, xanomKey } from "@/lib/server/xanom";
import { IOS_START_TTL_MS, sealIosStart } from "@/lib/xanom/state";

const Body = z.object({ intent: z.enum(["link", "convert"]), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

// POST /api/xanom/ios-start {intent: "link"|"convert", challenge}: the iOS app, signed in with
// its own session, gets the start link to open in its sign-in sheet. The link names the account
// for five minutes; the app must later show the secret behind `challenge` to finish.
export function POST(req: Request) {
  return handle(req, "Xanom link", async () => {
    if (!xanomConfig()) return fail("Xanom sign-in isn't available right now.", 503);
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    const body = Body.safeParse(await readJson(req));
    if (!body.success) return fail("Unknown request.", 400);
    const token = sealIosStart(xanomKey(), { userId, ...body.data, expiresAt: Date.now() + IOS_START_TTL_MS });
    const url = new URL("/api/xanom/start", appUrl());
    url.searchParams.set("platform", "ios");
    url.searchParams.set("intent", body.data.intent);
    url.searchParams.set("as", token);
    return ok({ url: url.toString() });
  });
}

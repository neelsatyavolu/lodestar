import { z } from "zod";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getPreferences } from "@/lib/db/preferences";
import { getUser } from "@/lib/db/users";
import { takeIosTicket } from "@/lib/db/xanom";
import { currentUserId, ipKey, startSession } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";
import { linkXanom } from "@/lib/xanom/link";
import { XANOM_ERRORS } from "@/lib/xanom/messages";
import { INTENTS, s256, safeEqual } from "@/lib/xanom/state";

const Body = z.object({ ticket: z.string().min(20).max(100), verifier: z.string().min(43).max(128) });

// POST /api/xanom/ios-exchange {ticket, verifier}: the iOS app redeems the one-time ticket from
// lodestar://xanom?ticket=… and gets its session cookie. The verifier is the secret whose hash
// the app sent when it started, so a ticket caught by another app is useless.
export function POST(req: Request) {
  return handle(req, "Xanom sign-in", async () => {
    if (!(await allow("xanomExchange", ipKey(req)))) return fail(XANOM_ERRORS.too_many, 429);
    const body = Body.safeParse(await readJson(req));
    if (!body.success) return fail(XANOM_ERRORS.expired, 400);
    const now = Date.now();
    const db = await getDb();
    const ticket = await takeIosTicket(db, body.data.ticket, now);
    if (!ticket || !safeEqual(s256(body.data.verifier), ticket.challenge)) return fail(XANOM_ERRORS.expired, 400);
    const intent = INTENTS.find((i) => i === ticket.intent) ?? "signin";

    let signedIn: string | null = null;
    if (intent !== "signin") {
      signedIn = await currentUserId();
      if (!signedIn || signedIn !== ticket.userId) return fail(XANOM_ERRORS.signed_out, 401);
    }
    const linked = await linkXanom(db, { sub: ticket.sub, email: ticket.email, name: ticket.name }, { intent, currentUserId: signedIn, now });
    if (!linked.ok) return fail(XANOM_ERRORS[linked.reason], 409);
    await startSession(linked.userId);
    const user = await getUser(db, linked.userId);
    const profile = { email: user!.email, createdAt: user!.createdAt, hasPassword: user!.passwordHash !== null, xanomEmail: user!.xanomEmail ?? user!.email };
    return ok({ user: profile, preferences: await getPreferences(db, linked.userId), created: linked.created });
  });
}

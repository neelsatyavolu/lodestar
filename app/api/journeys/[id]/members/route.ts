import { z } from "zod";
import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getJourney } from "@/lib/db/journeys";
import { inviteMember, listMembers, MAX_MEMBERS } from "@/lib/db/members";
import { getPreferences } from "@/lib/db/preferences";
import { getUser } from "@/lib/db/users";
import { inviteEmail, inviteLink, sendInvite } from "@/lib/journeys/invite-mail";
import { displayName } from "@/lib/preferences";
import { env } from "@/lib/server/env";
import { tripAccess, tripWrite, type TripCtx } from "@/lib/server/trip-owner";

const InviteSchema = z.object({ email: z.email("Enter an email address.").max(254), canEdit: z.boolean().default(false) });

// GET /api/journeys/:id/members: who the trip is shared with (owner only).
export function GET(req: Request, ctx: TripCtx) {
  return handle(req, "sharing", async () => {
    const who = await tripAccess(ctx, "own");
    if (who instanceof Response) return who;
    return ok({ members: (await listMembers(await getDb(), who.userId, who.id)) ?? [] });
  });
}

// POST /api/journeys/:id/members {email, canEdit}: invite someone, or send a fresh link to someone already invited.
export function POST(req: Request, ctx: TripCtx) {
  return tripWrite(req, ctx, "invite", async (who) => {
    if (who.role !== "owner") return fail("Only the trip's owner can invite people.", 403);
    const { email, canEdit } = InviteSchema.parse(await readJson(req, 2_000));
    const db = await getDb();
    const [me, trip, prefs] = await Promise.all([getUser(db, who.actorId), getJourney(db, who.userId, who.id), getPreferences(db, who.actorId)]);
    if (!me || !trip) return fail("That trip doesn't exist.", 404);
    if (email.trim().toLowerCase() === me.email.toLowerCase()) return fail("That's you. Invite someone else.", 400);
    const invite = await inviteMember(db, who.userId, who.id, email, canEdit, Date.now());
    if (!invite) return fail(`A trip can be shared with up to ${MAX_MEMBERS} people.`, 400);
    const url = inviteLink(env().APP_URL, invite.token);
    await sendInvite(invite.member.email, inviteEmail(displayName(prefs.displayName, me.email), trip.title, canEdit, url), url, env().RESEND_API_KEY);
    return ok({ member: invite.member });
  });
}

import { z } from "zod";
import { fail, handle, ok, rateLimited, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { acceptInvite } from "@/lib/db/members";
import { currentUserId } from "@/lib/server/auth";

const AcceptSchema = z.object({ token: z.string().max(100) });

// POST /api/invites/accept {token}: join the trip an invite link is for. Returns {journeyId}.
export function POST(req: Request) {
  return handle(req, "invite", async () => {
    const limited = rateLimited(req, "invite-accept", 10);
    if (limited) return limited;
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    const { token } = AcceptSchema.parse(await readJson(req, 500));
    const joined = await acceptInvite(await getDb(), userId, token, Date.now());
    return joined ? ok(joined) : fail("That invite has been used or has expired. Ask for a new one.", 410);
  });
}

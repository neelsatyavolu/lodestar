import { z } from "zod";
import { fail, handle, ok, readJson } from "@/lib/api";
import { verifyPassword } from "@/lib/account/password";
import { clearAiSessions } from "@/lib/ai/session";
import { getDb } from "@/lib/db/client";
import { getPreferences } from "@/lib/db/preferences";
import { deleteUser, endSessions, getUser } from "@/lib/db/users";
import { currentUserId, endSession, startSession } from "@/lib/server/auth";

// GET /api/account: who is signed in, with their saved preferences. Signed out is a normal answer.
export function GET(req: Request) {
  return handle(req, "account check", async () => {
    const userId = await currentUserId();
    const db = userId ? await getDb() : null;
    const user = db && userId ? await getUser(db, userId) : null;
    if (!db || !user) return ok({ user: null, preferences: null });
    return ok({
      user: { email: user.email, createdAt: user.createdAt, hasPassword: user.passwordHash !== null, xanomEmail: user.xanomSub ? user.xanomEmail ?? user.email : null },
      preferences: await getPreferences(db, user.id),
    });
  });
}

// POST /api/account {action: "signout-everywhere"}: end every other session.
export function POST(req: Request) {
  return handle(req, "sign-out", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    const body = z.object({ action: z.literal("signout-everywhere") }).safeParse(await readJson(req));
    if (!body.success) return fail("Unknown action.", 400);
    await endSessions(await getDb(), userId);
    await startSession(userId);
    return ok({});
  });
}

// DELETE /api/account {password} or, for an account with no password (made through Xanom),
// {confirm: true}: delete the account and its preferences.
export function DELETE(req: Request) {
  return handle(req, "account deletion", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    const body = z.object({ password: z.string().min(1).max(200).optional(), confirm: z.literal(true).optional() }).safeParse(await readJson(req));
    const db = await getDb();
    const user = await getUser(db, userId);
    if (!user) return fail("Sign in first.", 401);
    if (user.passwordHash === null) {
      if (!body.success || body.data.confirm !== true) return fail("Confirm that you want to delete your account.", 400);
    } else {
      if (!body.success || !body.data.password) return fail("Enter your password to delete your account.", 400);
      if (!(await verifyPassword(body.data.password, user.passwordHash))) return fail("That password isn't right.", 401);
    }
    await deleteUser(db, userId);
    await clearAiSessions();
    await endSession();
    return ok({});
  });
}

import { fail, handle, ok, readJson } from "@/lib/api";
import { resetPassword } from "@/lib/account/accounts";
import { MIN_PASSWORD_LENGTH, RESET_LINK_DEAD, resetSchema } from "@/lib/account/input";
import { getDb } from "@/lib/db/client";
import { ipKey, startSession } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";

// POST /api/account/reset {token, password}: set a new password from the emailed
// link, end every other session, and sign this browser in.
export function POST(req: Request) {
  return handle(req, "password reset", async () => {
    if (!(await allow("reset", ipKey(req)))) return fail("Too many attempts. Try again in 15 minutes.", 429);
    const body = resetSchema.safeParse(await readJson(req));
    if (!body.success) return fail(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
    const userId = await resetPassword(await getDb(), { ...body.data, now: Date.now() });
    if (!userId) return fail(RESET_LINK_DEAD, 400);
    await startSession(userId);
    return ok({});
  });
}

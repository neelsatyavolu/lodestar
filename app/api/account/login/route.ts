import { fail, handle, ok, readJson } from "@/lib/api";
import { signIn } from "@/lib/account/accounts";
import { loginSchema } from "@/lib/account/input";
import { getDb } from "@/lib/db/client";
import { getPreferences } from "@/lib/db/preferences";
import { ipKey, startSession } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";

// POST /api/account/login {email, password}
export function POST(req: Request) {
  return handle(req, "sign-in", async () => {
    if (!(await allow("login", ipKey(req)))) return fail("Too many attempts. Try again in 15 minutes.", 429);
    const body = loginSchema.safeParse(await readJson(req));
    if (!body.success) return fail("Enter your email and password.", 400);
    const db = await getDb();
    const userId = await signIn(db, body.data);
    if (!userId) return fail("That email and password don't match an account.", 401);
    await startSession(userId);
    return ok({ user: { email: body.data.email }, preferences: await getPreferences(db, userId) });
  });
}

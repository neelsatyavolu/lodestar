import { fail, handle, ok, readJson } from "@/lib/api";
import { register } from "@/lib/account/accounts";
import { MIN_PASSWORD_LENGTH, registerSchema } from "@/lib/account/input";
import { getDb } from "@/lib/db/client";
import { savePreferences } from "@/lib/db/preferences";
import { readPreferences } from "@/lib/preferences";
import { ipKey, startSession } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";

// POST /api/account/register {email, password, preferences?}: create an account and sign in.
// Preferences set before signing up come along, so nothing typed is lost.
export function POST(req: Request) {
  return handle(req, "sign-up", async () => {
    if (!(await allow("register", ipKey(req)))) return fail("Too many new accounts from here. Try again later.", 429);
    const raw = (await readJson(req)) as Record<string, unknown> | null;
    const body = registerSchema.safeParse(raw);
    if (!body.success) return fail(`Enter a valid email and a password of at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
    const db = await getDb();
    const userId = await register(db, { ...body.data, now: Date.now() });
    if (!userId) return fail("An account with that email already exists. Sign in instead.", 409);
    const preferences = readPreferences(raw?.preferences);
    await savePreferences(db, userId, preferences, Date.now());
    await startSession(userId);
    return ok({ user: { email: body.data.email }, preferences });
  });
}

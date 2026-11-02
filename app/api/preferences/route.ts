import { fail, handle, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { savePreferences } from "@/lib/db/preferences";
import { PreferencesSchema } from "@/lib/preferences";
import { currentUserId, ipKey } from "@/lib/server/auth";
import { allow } from "@/lib/server/limits";

// PUT /api/preferences: replace the signed-in account's saved travel preferences.
export function PUT(req: Request) {
  return handle(req, "preference save", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in to save preferences.", 401);
    if (!(await allow("preferences", ipKey(req)))) return fail("Too many saves. Try again in a few minutes.", 429);
    const prefs = PreferencesSchema.parse(await readJson(req));
    await savePreferences(await getDb(), userId, prefs, Date.now());
    return ok({ preferences: prefs });
  });
}

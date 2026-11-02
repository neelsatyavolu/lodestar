import { handle, ok } from "@/lib/api";
import { clearAiSessions } from "@/lib/ai/session";
import { endSession } from "@/lib/server/auth";

// POST /api/account/logout: sign out. This browser forgets its AI connection; one saved to the account stays with it.
export function POST(req: Request) {
  return handle(req, "sign-out", async () => {
    await clearAiSessions();
    await endSession();
    return ok({});
  });
}

import { handle, ok } from "@/lib/api";
import { clearAiSessions } from "@/lib/ai/session";
import { endSession } from "@/lib/server/auth";

// POST /api/account/logout: sign out, and forget this browser's AI connection too.
export function POST(req: Request) {
  return handle(req, "sign-out", async () => {
    await clearAiSessions();
    await endSession();
    return ok({});
  });
}

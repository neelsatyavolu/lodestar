import { fail, handle, ok, readJson } from "@/lib/api";
import { ModelError, complete } from "@/lib/ai/complete";
import { resolveModel } from "@/lib/ai/models";
import type { Provider } from "@/lib/ai/providers";
import { getDb } from "@/lib/db/client";
import { pendingMail, setMailState } from "@/lib/db/inbound";
import { READ_SYSTEM_PROMPT, parseReadItems, readUserPrompt } from "@/lib/journeys/ai";
import { fileItems } from "@/lib/journeys/ingest";
import { AiBodySchema } from "@/lib/journeys/input";
import { currentUserId } from "@/lib/server/auth";
import { aiTokens, senderKey } from "@/lib/server/journeys";
import { allow } from "@/lib/server/limits";

// Each email is one fast-model call; three fit comfortably in the time limit.
export const maxDuration = 300;
const PER_CALL = 3;

// POST /api/journeys/read {provider}: read waiting forwarded emails with the traveller's AI and file what they confirm.
// Called by the Trips page when it opens with AI connected, so AI only runs on the traveller's visit.
export function POST(req: Request) {
  return handle(req, "email reading", async () => {
    const userId = await currentUserId();
    if (!userId) return fail("Sign in first.", 401);
    const { provider } = AiBodySchema.parse(await readJson(req));
    if (!(await allow("journeysAi", senderKey("user", userId)))) return fail("That's a lot of AI calls. Try again in a few minutes.", 429);
    const tokens = await aiTokens(provider as Provider);
    if (tokens instanceof Response) return tokens;
    const db = await getDb();
    const model = await resolveModel(provider as Provider, undefined, "fast");
    let filed = 0;
    let read = 0;
    for (const mail of await pendingMail(db, userId, PER_CALL)) {
      let items;
      try {
        const text = await complete({ provider: provider as Provider, tokens, model, system: READ_SYSTEM_PROMPT, user: readUserPrompt(mail), effort: "low", signal: req.signal });
        items = parseReadItems(text);
      } catch (err) {
        // The connection or subscription failed: stop and leave the rest waiting.
        if (err instanceof ModelError) return read ? ok({ read, filed, error: err.message }) : fail(err.message, 502);
        await setMailState(db, userId, mail.id, "failed", null, "The AI answer couldn't be read.");
        read++;
        continue;
      }
      await db.transaction(async (tx) => {
        if (items.length) await fileItems(tx, userId, items, "email", Date.now());
        await setMailState(tx, userId, mail.id, items.length ? "parsed" : "ignored");
      });
      filed += items.length;
      read++;
    }
    return ok({ read, filed, error: null });
  });
}

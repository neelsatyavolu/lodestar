import { connection } from "next/server";
import { ok } from "@/lib/api";
import { aiModels } from "@/lib/ai/models";
import { aiOwner, hasSession } from "@/lib/ai/session";

// GET /api/ai/status: which AI accounts are connected (to the account when signed in, else this browser), and the models on offer.
export async function GET() {
  await connection();
  const owner = await aiOwner();
  const [codex, grok, models] = await Promise.all([hasSession("codex", owner), hasSession("grok", owner), aiModels()]);
  return ok({ connected: { codex, grok }, models });
}

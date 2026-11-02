import { connection } from "next/server";
import { ok } from "@/lib/api";
import { aiModels } from "@/lib/ai/models";
import { deviceId, hasSession } from "@/lib/ai/session";

// GET /api/ai/status: which AI accounts this browser has connected, and the models on offer.
export async function GET() {
  await connection();
  const owner = await deviceId();
  const [codex, grok, models] = await Promise.all([hasSession("codex", owner), hasSession("grok", owner), aiModels()]);
  return ok({ connected: { codex, grok }, models });
}

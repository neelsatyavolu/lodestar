import { connection, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { appUrl, xanomConfig } from "@/lib/server/xanom";
import { remoteJwks } from "@/lib/xanom/oidc";
import { buildSummary, summarySub } from "@/lib/xanom/summary";

const headers = { "cache-control": "no-store" };

// GET /api/xanom/summary with Authorization: Bearer <JWT signed by accounts.xanom.co>:
// the counts and recent trips its dashboard shows on Lodestar's card.
export async function GET(req: Request) {
  await connection();
  const config = xanomConfig();
  if (!config) return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  const now = Date.now();
  const sub = await summarySub(config, req.headers.get("authorization"), remoteJwks(config.issuer), now);
  if (!sub) return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: { ...headers, "www-authenticate": 'Bearer error="invalid_token"' } });
  try {
    return NextResponse.json(await buildSummary(await getDb(), sub, appUrl(), now), { headers });
  } catch (err) {
    console.error("[xanom] summary failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "unavailable" }, { status: 500, headers });
  }
}

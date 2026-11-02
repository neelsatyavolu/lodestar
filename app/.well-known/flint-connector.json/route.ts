import { connection, NextResponse } from "next/server";
import { manifest } from "@/lib/connectors/flint";
import { env } from "@/lib/server/env";

// GET /.well-known/flint-connector.json: what Flint reads to connect Lodestar (connector protocol v1).
export async function GET() {
  // Built from APP_URL at request time, never prerendered at build.
  await connection();
  return NextResponse.json(manifest(env().APP_URL), { headers: { "cache-control": "public, max-age=3600" } });
}

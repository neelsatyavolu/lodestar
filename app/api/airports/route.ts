import { ok } from "@/lib/api";
import { searchAirports } from "@/lib/airports";

// GET /api/airports?q=new y — airport and metro-area suggestions.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 60) ?? "";
  return ok(searchAirports(q), { headers: { "cache-control": "public, max-age=86400" } });
}

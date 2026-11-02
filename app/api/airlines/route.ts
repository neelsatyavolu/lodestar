import { ok } from "@/lib/api";
import { searchAirlines } from "@/lib/airline-search";

// GET /api/airlines?q=delta — airline suggestions for the preferences picker.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 40) ?? "";
  return ok(searchAirlines(q), { headers: { "cache-control": "public, max-age=86400" } });
}

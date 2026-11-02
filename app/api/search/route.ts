import { fromError, ok, rateLimited, readJson } from "@/lib/api";
import { runSearch } from "@/lib/search";
import { SearchQuerySchema } from "@/lib/types";

// Google can be slow; leave room beyond the fares client timeout.
export const maxDuration = 60;

// POST /api/search: live fares plus the travel hacks computed from them.
export async function POST(req: Request) {
  const limited = rateLimited(req, "search", 20);
  if (limited) return limited;
  try {
    const query = SearchQuerySchema.parse(await readJson(req));
    return ok(await runSearch(query, req.signal));
  } catch (err) {
    return fromError(err, "search");
  }
}

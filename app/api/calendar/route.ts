import { fromError, ok, rateLimited, readJson } from "@/lib/api";
import { runCalendar } from "@/lib/search";
import { SearchQuerySchema } from "@/lib/types";

// Google can be slow; leave room beyond the fares client timeout.
export const maxDuration = 60;

// POST /api/calendar: lowest fare per day around the chosen dates. Separate from
// /api/search because Google can take a while here and results shouldn't wait.
export async function POST(req: Request) {
  const limited = rateLimited(req, "calendar", 20);
  if (limited) return limited;
  try {
    const query = SearchQuerySchema.parse(await readJson(req));
    return ok(await runCalendar(query, req.signal));
  } catch (err) {
    return fromError(err, "date check");
  }
}

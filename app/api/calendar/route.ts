import { z } from "zod";
import { fromError, ok, rateLimited, readJson } from "@/lib/api";
import { runCalendar } from "@/lib/search";
import { SearchQuerySchema } from "@/lib/types";

// Google can be slow; leave room beyond the fares client timeout.
export const maxDuration = 60;

const Window = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// POST /api/calendar: lowest fare per day. Around the chosen dates by default,
// or across `window` (the calendar picker's visible months, up to two months).
export async function POST(req: Request) {
  const limited = rateLimited(req, "calendar", 30);
  if (limited) return limited;
  try {
    const body = (await readJson(req)) as Record<string, unknown> | null;
    const query = SearchQuerySchema.parse(body);
    const window = body?.window === undefined ? undefined : Window.parse(body.window);
    return ok(await runCalendar(query, req.signal, window));
  } catch (err) {
    return fromError(err, "date check");
  }
}

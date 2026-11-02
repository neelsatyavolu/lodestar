import { z } from "zod";
import { fromError, ok, rateLimited, readJson } from "@/lib/api";
import { bookingPage } from "@/lib/fares";
import { verify } from "@/lib/verify";

// Google can be slow; leave room beyond the fares client timeout.
export const maxDuration = 60;

const Body = z.object({
  tfs: z.string().regex(/^[A-Za-z0-9_-]{16,2048}$/, "Invalid itinerary."),
  airlines: z.array(z.object({ code: z.string().max(3), name: z.string().max(80) })).max(12).default([]),
  price: z.number().positive().max(1_000_000).optional(),
});

// POST /api/sellers: who sells this exact itinerary, at what fare, and which of them we trust.
export async function POST(req: Request) {
  const limited = rateLimited(req, "sellers", 40);
  if (limited) return limited;
  try {
    const { tfs, airlines, price } = Body.parse(await readJson(req));
    return ok(verify(await bookingPage(tfs, req.signal), airlines, price));
  } catch (err) {
    return fromError(err, "seller check");
  }
}

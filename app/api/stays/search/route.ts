import { fromError, ok, rateLimited, readJson } from "@/lib/api";
import { searchStays } from "@/lib/fares";
import { pastCheckin } from "@/lib/stays/input";
import { StaysSearchSchema } from "@/lib/stays/types";

// Google Hotels can be slow; leave room beyond the fares client timeout.
export const maxDuration = 60;

// POST /api/stays/search {city, checkin, checkout, adults}: hotels with Google's "from" price per night.
export async function POST(req: Request) {
  const limited = rateLimited(req, "stays", 20);
  if (limited) return limited;
  try {
    const query = StaysSearchSchema.parse(await readJson(req));
    return pastCheckin(query.checkin) ?? ok(await searchStays(query, req.signal));
  } catch (err) {
    return fromError(err, "hotel search");
  }
}

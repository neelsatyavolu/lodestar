import { fromError, ok, rateLimited, readJson } from "@/lib/api";
import { searchStays } from "@/lib/fares";
import { flexSavings, shiftedDates, type Shift } from "@/lib/stays/flex";
import { pastCheckin } from "@/lib/stays/input";
import { nights, StaysSearchSchema } from "@/lib/stays/types";

export const maxDuration = 60;
const SHIFTS: Shift[] = ["earlier", "later"];

// POST /api/stays/flex {city, checkin, checkout, adults}: per hotel, what arriving a night earlier or later saves.
// The base search is usually still cached by the fares service from /api/stays/search.
export async function POST(req: Request) {
  const limited = rateLimited(req, "stays", 20);
  if (limited) return limited;
  try {
    const query = StaysSearchSchema.parse(await readJson(req));
    const past = pastCheckin(query.checkin);
    if (past) return past;
    const today = new Date().toISOString().slice(0, 10);
    const runs = SHIFTS.map((shift) => ({ shift, ...shiftedDates(query.checkin, query.checkout, shift) })).filter((r) => r.checkin >= today);
    const [base, ...shifted] = await Promise.all([
      searchStays(query, req.signal),
      // One shifted search failing shouldn't hide the other.
      ...runs.map((r) => searchStays({ ...query, checkin: r.checkin, checkout: r.checkout }, req.signal).then((s) => ({ ...r, hotels: s.hotels })).catch(() => null)),
    ]);
    const done = shifted.filter((s): s is NonNullable<typeof s> => s !== null);
    return ok({ savings: flexSavings(base.hotels, done, nights(query)) });
  } catch (err) {
    return fromError(err, "date check");
  }
}

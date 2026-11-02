import { fromError, ok, rateLimited, readJson } from "@/lib/api";
import { stayOffers } from "@/lib/fares";
import { pastCheckin } from "@/lib/stays/input";
import { verifyOffers } from "@/lib/stays/offers";
import { StaysPricesSchema } from "@/lib/stays/types";

export const maxDuration = 60;

// POST /api/stays/prices {key, checkin, checkout, adults}: every seller's price for this hotel and which of them we trust.
export async function POST(req: Request) {
  const limited = rateLimited(req, "stayPrices", 40);
  if (limited) return limited;
  try {
    const query = StaysPricesSchema.parse(await readJson(req));
    const past = pastCheckin(query.checkin);
    if (past) return past;
    const { offers, url } = await stayOffers(query, req.signal);
    return ok({ offers: verifyOffers(offers), url });
  } catch (err) {
    return fromError(err, "hotel prices");
  }
}

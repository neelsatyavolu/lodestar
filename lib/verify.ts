import { airlineLogo, sellerAirline } from "./airlines";
import { sellerDomain, sellerTier, type SellerTier } from "./sellers";
import type { BookingPage } from "./types";

export type VerifiedSeller = BookingPage["sellers"][number] & { tier: SellerTier; logo: string };

export type Verified = {
  sellers: VerifiedSeller[];
  insight: BookingPage["insight"];
  bookingUrl: string;
  lowestAny: number | null;
  lowestTrusted: number | null;
  trustedSeller: string | null;
  /** How much cheaper the cheapest unvetted seller is than the cheapest trusted one. */
  unvettedGap: number;
};

function monogramLogo(name: string): string {
  return `/api/logo/site/_?name=${encodeURIComponent(name)}`;
}

// A booking page can list fares from other cabins too (economy fares on a
// business itinerary). Fares this far under the searched price are not the
// fare that was searched for, so they don't count toward a seller's price.
const OTHER_CABIN_RATIO = 0.8;

export function verify(page: BookingPage, airlines: { code: string; name: string }[], searchedPrice?: number): Verified {
  const floor = searchedPrice ? searchedPrice * OTHER_CABIN_RATIO : 0;
  const comparable = page.sellers
    .map((s) => {
      const fares = s.fares.filter((f) => f.price >= floor);
      return fares.length ? { ...s, fares, lowest: Math.min(...fares.map((f) => f.price)) } : null;
    })
    .filter((s): s is BookingPage["sellers"][number] => s !== null);
  const sellers: VerifiedSeller[] = (comparable.length ? comparable : page.sellers).map((s) => {
    const tier = sellerTier(s.name, s.is_airline);
    let logo: string;
    if (tier === "airline") {
      const code = sellerAirline(s.name, airlines);
      logo = code ? airlineLogo(code) : monogramLogo(s.name);
    } else {
      const domain = sellerDomain(s.name);
      logo = domain ? `/api/logo/site/${encodeURIComponent(domain)}?name=${encodeURIComponent(s.name)}` : monogramLogo(s.name);
    }
    return { ...s, tier, logo };
  });
  const order: Record<SellerTier, number> = { airline: 0, trusted: 1, unvetted: 2 };
  const sorted = [...sellers].sort((a, b) => a.lowest - b.lowest || order[a.tier] - order[b.tier]);
  const trusted = sorted.filter((s) => s.tier !== "unvetted");
  const unvetted = sorted.filter((s) => s.tier === "unvetted");
  const lowestTrusted = trusted[0]?.lowest ?? null;
  const lowestUnvetted = unvetted[0]?.lowest ?? null;
  return {
    sellers: sorted,
    insight: page.insight,
    bookingUrl: page.booking_url,
    lowestAny: sorted[0]?.lowest ?? null,
    lowestTrusted,
    trustedSeller: trusted[0]?.name ?? null,
    unvettedGap: lowestTrusted !== null && lowestUnvetted !== null ? Math.max(0, lowestTrusted - lowestUnvetted) : 0,
  };
}

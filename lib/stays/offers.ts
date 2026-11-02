import { sellerDomain, sellerTier, type SellerTier } from "../sellers";
import type { Offer } from "./types";

// Who sells a room, and how much more a refundable rate costs. The hotel's own
// site counts as direct, like an airline for flights: best when plans change.

export type VerifiedOffer = Offer & { tier: SellerTier; logo: string };

export const STAY_TIER_LABEL: Record<SellerTier, string> = {
  airline: "Hotel direct",
  trusted: "Trusted agency",
  unvetted: "Not vetted",
};

function logo(o: Offer): string {
  const domain = o.official ? null : sellerDomain(o.seller);
  return domain ? `/api/logo/site/${encodeURIComponent(domain)}?name=${encodeURIComponent(o.seller)}` : `/api/logo/site/_?name=${encodeURIComponent(o.seller)}`;
}

const ORDER: Record<SellerTier, number> = { airline: 0, trusted: 1, unvetted: 2 };

/** Every offer with its seller's tier, cheapest stay first (direct first on a tie). */
export function verifyOffers(offers: Offer[]): VerifiedOffer[] {
  return offers
    .map((o) => ({ ...o, tier: sellerTier(o.seller, o.official) }))
    .map((o) => ({ ...o, logo: logo(o) }))
    .sort((a, b) => a.total - b.total || ORDER[a.tier] - ORDER[b.tier]);
}

export type Refundable =
  /** The cheapest rate shown can already be cancelled for free. */
  | { kind: "included"; offer: VerifiedOffer }
  /** A refundable rate costs this much more for the whole stay. */
  | { kind: "extra"; offer: VerifiedOffer; extra: number; perNight: number }
  | { kind: "none" };

/** The refundable-for-a-little-more trick, among the offers the traveller sees. */
export function refundable(offers: VerifiedOffer[], nights: number): Refundable {
  const cheapest = offers[0];
  const flexible = offers.find((o) => o.free_cancel_until !== null);
  if (!cheapest || !flexible) return { kind: "none" };
  if (flexible === cheapest || flexible.total <= cheapest.total) return { kind: "included", offer: flexible };
  const extra = flexible.total - cheapest.total;
  return { kind: "extra", offer: flexible, extra, perNight: extra / Math.max(1, nights) };
}

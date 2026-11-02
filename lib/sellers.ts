// Who sells a fare, and whether Contrail shows them by default.
//
// "airline"  — the airline itself (Google marks these). Best when plans change.
// "trusted"  — large, long-established agencies: brands of public travel
//              companies (Expedia Group, Booking Holdings, Trip.com Group) and
//              card-issuer travel portals. Real customer service, accredited.
// "unvetted" — everyone else. Not a judgement that they are bad: we have not
//              vetted them, and smaller agencies are harder to deal with when
//              a flight changes. Hidden unless the traveller asks to see them.

export type SellerTier = "airline" | "trusted" | "unvetted";

type Known = { domain: string; tier: Exclude<SellerTier, "airline"> };

const KNOWN: Record<string, Known> = {
  expedia: { domain: "expedia.com", tier: "trusted" },
  orbitz: { domain: "orbitz.com", tier: "trusted" },
  travelocity: { domain: "travelocity.com", tier: "trusted" },
  cheaptickets: { domain: "cheaptickets.com", tier: "trusted" },
  hotwire: { domain: "hotwire.com", tier: "trusted" },
  ebookers: { domain: "ebookers.com", tier: "trusted" },
  wotif: { domain: "wotif.com", tier: "trusted" },
  priceline: { domain: "priceline.com", tier: "trusted" },
  "booking.com": { domain: "booking.com", tier: "trusted" },
  kayak: { domain: "kayak.com", tier: "trusted" },
  agoda: { domain: "agoda.com", tier: "trusted" },
  "trip.com": { domain: "trip.com", tier: "trusted" },
  "american express travel": { domain: "americanexpress.com", tier: "trusted" },
  "chase travel": { domain: "chase.com", tier: "trusted" },
  "capital one travel": { domain: "capitalone.com", tier: "trusted" },
  "costco travel": { domain: "costcotravel.com", tier: "trusted" },
  flighthub: { domain: "flighthub.com", tier: "unvetted" },
  justfly: { domain: "justfly.com", tier: "unvetted" },
  gotogate: { domain: "gotogate.com", tier: "unvetted" },
  mytrip: { domain: "mytrip.com", tier: "unvetted" },
  flightnetwork: { domain: "flightnetwork.com", tier: "unvetted" },
  onetravel: { domain: "onetravel.com", tier: "unvetted" },
  cheapoair: { domain: "cheapoair.com", tier: "unvetted" },
  "kiwi.com": { domain: "kiwi.com", tier: "unvetted" },
  wego: { domain: "wego.com", tier: "unvetted" },
  travomint: { domain: "travomint.com", tier: "unvetted" },
  ovago: { domain: "ovago.com", tier: "unvetted" },
  edreams: { domain: "edreams.com", tier: "unvetted" },
  opodo: { domain: "opodo.com", tier: "unvetted" },
  budgetair: { domain: "budgetair.com", tier: "unvetted" },
  hopper: { domain: "hopper.com", tier: "unvetted" },
  skiplagged: { domain: "skiplagged.com", tier: "unvetted" },
  scholartrip: { domain: "scholartrip.com", tier: "unvetted" },
  arangrant: { domain: "arangrant.com", tier: "unvetted" },
  "oojo x dreampass": { domain: "oojo.com", tier: "unvetted" },
  oojo: { domain: "oojo.com", tier: "unvetted" },
  jettzy: { domain: "jettzy.com", tier: "unvetted" },
  jetabroad: { domain: "jetabroad.com", tier: "unvetted" },
};

function lookup(name: string): Known | undefined {
  const lower = name.trim().toLowerCase();
  return KNOWN[lower] ?? KNOWN[lower.replace(/\.com$/, "")];
}

export function sellerTier(name: string, isAirline: boolean): SellerTier {
  if (isAirline) return "airline";
  return lookup(name)?.tier ?? "unvetted";
}

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A domain to fetch a site icon for, or null when we only know the name. */
export function sellerDomain(name: string): string | null {
  const known = lookup(name)?.domain;
  if (known) return known;
  const lower = name.trim().toLowerCase();
  return DOMAIN_RE.test(lower) ? lower : null;
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain) && domain.length <= 80;
}

export const TIER_LABEL: Record<SellerTier, string> = {
  airline: "Airline direct",
  trusted: "Trusted agency",
  unvetted: "Not vetted",
};

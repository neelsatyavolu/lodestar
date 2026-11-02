// Airline display names. fli's enum carries some retired names (AZ is still
// "Alitalia"); these overrides fix the ones travellers will notice.
const NAME_OVERRIDES: Record<string, string> = {
  AZ: "ITA Airways",
  AA: "American",
  UA: "United",
  DL: "Delta",
  WN: "Southwest",
  B6: "JetBlue",
  AS: "Alaska",
  NK: "Spirit",
  F9: "Frontier",
  HA: "Hawaiian",
  G4: "Allegiant",
  SY: "Sun Country",
  MX: "Breeze",
  XP: "Avelo",
  AC: "Air Canada",
  WS: "WestJet",
  BA: "British Airways",
  VS: "Virgin Atlantic",
  LH: "Lufthansa",
  AF: "Air France",
  KL: "KLM",
};

/** Ultra-low-cost carriers: the headline fare usually excludes a carry-on. */
export const ULTRA_LOW_COST = new Set(["NK", "F9", "G4", "SY", "XP", "MX", "W6", "FR", "U2", "VY", "DY", "W9", "Y4", "VB", "JQ", "TR", "AK"]);

export function airlineName(code: string, fallback: string): string {
  return NAME_OVERRIDES[code] ?? fallback;
}

export function airlineLogo(code: string): string {
  return `/api/logo/airline/${encodeURIComponent(code)}`;
}

/** Match a seller name ("American", "ITA") to one of the itinerary's airline codes. */
export function sellerAirline(seller: string, airlines: { code: string; name: string }[]): string | null {
  const s = seller.trim().toLowerCase();
  for (const a of airlines) {
    const names = [a.name, airlineName(a.code, a.name)].map((n) => n.toLowerCase());
    if (names.some((n) => n === s || n.startsWith(s) || s.startsWith(n))) return a.code;
  }
  return airlines[0]?.code ?? null;
}

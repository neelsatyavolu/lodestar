// Airline stopover programs: a connection through the airline's hub can become
// a stay of several days, at no extra airfare or with hotel nights included.
// Sources (checked 2026-11-01): AirTreks "Airline Stopover Programs" (as of
// 2026-10-21) for Icelandair, Turkish, Etihad and Qatar; Passrider "15 Airline
// Stopover Programs in 2026" for TAP, Iberia and Copa. Rules change and depend
// on the fare, so the copy always says to confirm with the airline.

export type Stopover = { airline: string; name: string; hubs: string[]; city: string; offer: string; rules: string };

export const STOPOVERS: Stopover[] = [
  { airline: "FI", name: "Icelandair", hubs: ["KEF"], city: "Reykjavik", offer: "a stop in Iceland of up to 7 nights at no extra airfare", rules: "Transatlantic trips; Flex fares allow up to 21 nights." },
  { airline: "TP", name: "TAP Air Portugal", hubs: ["LIS", "OPO"], city: "Lisbon or Porto", offer: "a stop in Portugal of up to 10 days at no extra airfare", rules: "Eligible TAP itineraries via Lisbon or Porto." },
  { airline: "IB", name: "Iberia", hubs: ["MAD"], city: "Madrid", offer: "a stop in Madrid of up to 9 nights", rules: "Eligible Iberia itineraries via Madrid." },
  { airline: "CM", name: "Copa Airlines", hubs: ["PTY"], city: "Panama City", offer: "a stop in Panama of up to 7 days at no extra airfare", rules: "Eligible Copa itineraries via Panama City." },
  { airline: "TK", name: "Turkish Airlines", hubs: ["IST"], city: "Istanbul", offer: "1 to 3 free hotel nights in Istanbul on a stop of 20 hours to 7 days", rules: "Round trip, every flight on Turkish, one booking; apply at least 72 hours before." },
  { airline: "EY", name: "Etihad", hubs: ["AUH"], city: "Abu Dhabi", offer: "1 or 2 free hotel nights in Abu Dhabi on a stop of 24 hours to 4 days", rules: "Return ticket on Etihad, booked directly with Etihad." },
  { airline: "QR", name: "Qatar Airways", hubs: ["DOH"], city: "Doha", offer: "discounted Doha hotel packages (from about $14 a night) on a stop of 12 to 96 hours", rules: "Qatar Airways tickets; up to one stop each way." },
];

const BY_AIRLINE = new Map(STOPOVERS.map((s) => [s.airline, s]));

/** The stopover program that applies to a connection at `airport` arriving on `airline`, if any. */
export function stopoverFor(airline: string, airport: string): Stopover | null {
  const s = BY_AIRLINE.get(airline);
  return s && s.hubs.includes(airport) ? s : null;
}

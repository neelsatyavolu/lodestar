import data from "@/data/airlines.json";
import { airlineName } from "./airlines";

// Airline suggestions for the preferences picker, from fli's airline list.

type Airline = { code: string; name: string };
const AIRLINES = (data as Airline[]).map((a) => ({ code: a.code, name: airlineName(a.code, a.name) }));
const BY_CODE = new Map(AIRLINES.map((a) => [a.code, a]));

// Names people search for most, so "american" finds AA before American Jet.
const POPULAR = new Set(["AA", "UA", "DL", "WN", "B6", "AS", "NK", "F9", "HA", "AC", "BA", "LH", "AF", "KL", "EK", "QR", "SQ", "CX", "NH", "JL", "QF", "TK", "EY", "VS", "IB", "LX", "OS", "SK", "AY", "EI", "FR", "U2", "6E", "AI", "AM", "LA", "AV", "CM", "WS", "KE", "OZ", "BR", "CI", "TP", "AZ"]);

export function airlineByCode(code: string): Airline | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function searchAirlines(query: string, limit = 8): Airline[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return AIRLINES.map((a) => {
    const name = a.name.toLowerCase();
    let score = 0;
    if (a.code.toLowerCase() === q) score = 100;
    else if (name === q) score = 90;
    else if (name.startsWith(q)) score = 60;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 40;
    else if (name.includes(q)) score = 20;
    return { a, score: score ? score + (POPULAR.has(a.code) ? 15 : 0) : 0 };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name))
    .slice(0, limit)
    .map((x) => x.a);
}

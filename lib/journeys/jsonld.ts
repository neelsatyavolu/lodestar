import { airport, METROS } from "../airports";
import { DraftItemSchema, type DraftItem } from "./types";

// Reads schema.org reservation markup (JSON-LD) that airlines, hotels and
// booking sites put in confirmation emails. Deterministic, so it runs the
// moment mail arrives; anything it can't read waits for the AI reader.
// Times are kept as the local wall-clock time the confirmation states.

type Node = Record<string, unknown>;

const SCRIPT = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const ENTITIES: Record<string, string> = { "&quot;": '"', "&#34;": '"', "&apos;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };

function parseJson(raw: string): unknown {
  const body = raw.trim().replace(/^<!--|-->$/g, "");
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(body.replace(/&(quot|#34|apos|#39|lt|gt|amp);/g, (m) => ENTITIES[m] ?? m));
    } catch {
      return null;
    }
  }
}

/** Every object in the markup, with @graph and arrays flattened. */
export function jsonLdNodes(html: string): Node[] {
  const out: Node[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    const node = v as Node;
    if (node["@graph"]) visit(node["@graph"], depth + 1);
    out.push(node);
  };
  for (const m of html.matchAll(SCRIPT)) visit(parseJson(m[1] ?? ""), 0);
  return out;
}

const typeOf = (n: unknown): string => {
  const t = n && typeof n === "object" ? (n as Node)["@type"] : undefined;
  const first = Array.isArray(t) ? t[0] : t;
  return typeof first === "string" ? first.replace(/^https?:\/\/schema\.org\//, "") : "";
};
const obj = (v: unknown): Node => (v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : Array.isArray(v) && v[0] && typeof v[0] === "object" ? (v[0] as Node) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

/** "2027-03-01T10:15:00-08:00" → date and local HH:MM as written (no zone conversion). */
export function splitLocal(v: unknown): { date: string; time: string | null } | null {
  const s = str(v);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { date: m[1], time: m[2] && m[3] ? `${m[2]}:${m[3]}` : null };
}

function address(v: unknown): string | undefined {
  if (typeof v === "string") return str(v);
  const a = obj(v);
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].map((p) => str(typeof p === "object" ? obj(p).name : p)).filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

const city = (v: unknown): string | undefined => {
  if (typeof v === "string") return undefined;
  return str(obj(v).addressLocality);
};

/** The city a traveller would name for an airport: "Tokyo" for NRT, not "Narita". */
export function cityForAirport(code: string): string | undefined {
  const upper = code.toUpperCase();
  const metro = Object.values(METROS).find((m) => m.codes.includes(upper));
  if (metro) return metro.name.replace(/\s*\(all airports\)|\s+area$/i, "");
  return airport(upper)?.city;
}

const cancelled = (r: Node) => /Cancel/i.test(str(r.reservationStatus) ?? "");

function flight(r: Node): DraftItem | null {
  const f = obj(r.reservationFor);
  const airline = obj(f.airline);
  const code = str(airline.iataCode) ?? str(f.provider && obj(f.provider).iataCode);
  const rawNumber = str(f.flightNumber)?.replace(/\s+/g, "");
  const number = code && rawNumber?.toUpperCase().startsWith(code.toUpperCase()) ? rawNumber.slice(code.length) : rawNumber;
  const dep = obj(f.departureAirport);
  const arr = obj(f.arrivalAirport);
  const from = str(dep.iataCode) ?? str(dep.name);
  const to = str(arr.iataCode) ?? str(arr.name);
  const start = splitLocal(f.departureTime) ?? splitLocal(r.startTime);
  if (!start || !(from || to)) return null;
  const end = splitLocal(f.arrivalTime);
  const toCity = to && /^[A-Z]{3}$/.test(to) ? cityForAirport(to) : to;
  const label = [code, number].filter(Boolean).join(" ");
  return parse({
    kind: "flight",
    status: cancelled(r) ? "cancelled" : "booked",
    title: `${label ? `${label} · ` : ""}${from ?? "?"} → ${to ?? "?"}`,
    startDate: start.date,
    startTime: start.time,
    endDate: end?.date ?? null,
    endTime: end?.time ?? null,
    place: toCity ?? null,
    confirmation: str(r.reservationNumber) ?? null,
    details: { airline: str(airline.name) ?? code, flightNumber: label || undefined, from, to },
  });
}

function stay(r: Node): DraftItem | null {
  const h = obj(r.reservationFor);
  const name = str(h.name);
  const start = splitLocal(r.checkinTime) ?? splitLocal(r.checkinDate);
  if (!name || !start) return null;
  const end = splitLocal(r.checkoutTime) ?? splitLocal(r.checkoutDate);
  return parse({
    kind: "stay",
    status: cancelled(r) ? "cancelled" : "booked",
    title: name,
    startDate: start.date,
    startTime: start.time,
    endDate: end?.date ?? null,
    endTime: end?.time ?? null,
    place: city(h.address) ?? null,
    confirmation: str(r.reservationNumber) ?? null,
    details: { address: address(h.address), phone: str(h.telephone) },
  });
}

function venue(r: Node, kind: "dining" | "activity"): DraftItem | null {
  const v = obj(r.reservationFor);
  const name = str(v.name);
  const loc = obj(v.location);
  const start = splitLocal(r.startTime) ?? splitLocal(v.startDate) ?? splitLocal(v.startTime);
  if (!name || !start) return null;
  const end = splitLocal(r.endTime) ?? splitLocal(v.endDate);
  const addr = v.address ?? loc.address;
  const party = Number(r.partySize);
  return parse({
    kind,
    status: cancelled(r) ? "cancelled" : "booked",
    title: name,
    startDate: start.date,
    startTime: start.time,
    endDate: end?.date ?? null,
    endTime: end?.time ?? null,
    place: city(addr) ?? str(loc.name) ?? null,
    confirmation: str(r.reservationNumber) ?? null,
    details: { address: address(addr), phone: str(v.telephone), guests: Number.isInteger(party) && party > 0 && party <= 30 ? party : undefined },
  });
}

function car(r: Node): DraftItem | null {
  const start = splitLocal(r.pickupTime);
  if (!start) return null;
  const end = splitLocal(r.dropoffTime);
  const company = str(obj(obj(r.reservationFor).rentalCompany).name) ?? str(obj(r.provider).name);
  const pickup = obj(r.pickupLocation);
  return parse({
    kind: "transport",
    status: cancelled(r) ? "cancelled" : "booked",
    title: `${company ?? "Rental car"} pickup`,
    startDate: start.date,
    startTime: start.time,
    endDate: end?.date ?? null,
    endTime: end?.time ?? null,
    place: city(pickup.address) ?? str(pickup.name) ?? null,
    confirmation: str(r.reservationNumber) ?? null,
    details: { provider: company, address: address(pickup.address) ?? str(pickup.name) },
  });
}

function trip(r: Node): DraftItem | null {
  const t = obj(r.reservationFor);
  const from = str(obj(t.departureStation ?? t.departureBusStop).name);
  const to = str(obj(t.arrivalStation ?? t.arrivalBusStop).name);
  const start = splitLocal(t.departureTime);
  if (!start || !(from || to)) return null;
  const end = splitLocal(t.arrivalTime);
  const company = str(obj(t.trainCompany ?? t.busCompany ?? t.provider).name);
  return parse({
    kind: "transport",
    status: cancelled(r) ? "cancelled" : "booked",
    title: `${company ? `${company} · ` : ""}${from ?? "?"} → ${to ?? "?"}`,
    startDate: start.date,
    startTime: start.time,
    endDate: end?.date ?? null,
    endTime: end?.time ?? null,
    place: to ?? null,
    confirmation: str(r.reservationNumber) ?? null,
    details: { provider: company, from, to },
  });
}

function parse(raw: unknown): DraftItem | null {
  const clean = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const r = DraftItemSchema.safeParse(clean);
  return r.success ? r.data : null;
}

const READERS: Record<string, (r: Node) => DraftItem | null> = {
  FlightReservation: flight,
  LodgingReservation: stay,
  FoodEstablishmentReservation: (r) => venue(r, "dining"),
  EventReservation: (r) => venue(r, "activity"),
  RentalCarReservation: car,
  TrainReservation: trip,
  BusReservation: trip,
};

export const RESERVATION_TYPES = Object.keys(READERS);

/** Every reservation the email's markup describes, validated. */
export function reservationsFromHtml(html: string): DraftItem[] {
  return jsonLdNodes(html)
    .map((n) => READERS[typeOf(n)]?.(n) ?? null)
    .filter((x): x is DraftItem => x !== null);
}

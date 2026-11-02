import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { RESERVATION_TYPES } from "../journeys/jsonld";

// Lodestar's side of the Flint connector protocol v1: the manifest Flint reads,
// one-time pairing codes, and checking that a delivery was signed with the
// secret Flint handed over at pairing. See
// docs/superpowers/specs/2026-11-02-trips-organizer-design.md.

export const SIGNATURE_WINDOW_S = 5 * 60;
export const PAIR_CODE_TTL_MS = 10 * 60_000;
// No 0/O, 1/I/L: the code is read off one screen and typed into another.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Travel senders whose confirmations often lack markup. JSON-LD catches the rest. */
const TRAVEL_SENDERS = [
  "united.com", "delta.com", "aa.com", "southwest.com", "jetblue.com", "alaskaair.com", "aircanada.ca", "britishairways.com", "lufthansa.com", "airfrance.fr", "klm.com", "emirates.com", "qatarairways.com.qa", "singaporeair.com", "cathaypacific.com", "ana.co.jp", "jal.com", "turkishairlines.com", "iberia.com", "virginatlantic.com", "flyfrontier.com", "spirit.com", "ryanair.com", "easyjet.com",
  "marriott.com", "hilton.com", "hyatt.com", "ihg.com", "accor.com", "airbnb.com", "booking.com", "expedia.com", "hotels.com", "vrbo.com", "agoda.com", "trip.com", "kayak.com", "priceline.com",
  "opentable.com", "resy.com", "sevenrooms.com", "tock.com", "exploretock.com", "getyourguide.com", "viator.com", "klook.com", "eventbrite.com", "ticketmaster.com",
  "hertz.com", "avis.com", "enterprise.com", "nationalcar.com", "sixt.com", "amtrak.com", "eurostar.com", "trainline.com", "renfe.com", "sncf-connect.com",
];

export function manifest(appUrl: string) {
  const base = appUrl.replace(/\/$/, "");
  return {
    flintConnector: 1,
    id: "co.xanom.lodestar",
    name: "Lodestar",
    description: "Turns your flight, hotel and reservation confirmations into trips.",
    homepage: base,
    pairPage: `${base}/?connect=flint`,
    pairEndpoint: `${base}/api/connectors/flint/pair`,
    deliverEndpoint: `${base}/api/connectors/flint/deliver`,
    revokeEndpoint: `${base}/api/connectors/flint/revoke`,
    match: {
      any: TRAVEL_SENDERS.map((domain) => ({ field: "from", op: "ends_with", value: `@${domain}` })),
      schemaTypes: RESERVATION_TYPES,
    },
    fields: ["messageId", "from", "to", "subject", "date", "text", "html"],
    historyDays: 365,
  };
}

/** An 8-character code, shown as XXXX-XXXX. */
export function newPairCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** Normalizes what the traveller typed (spaces, dashes, lowercase) before hashing. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function hashCode(pepper: Buffer, code: string): string {
  return createHmac("sha256", pepper).update(`flint-pair:${normalizeCode(code)}`).digest("base64url");
}

export const PairSchema = z.object({
  code: z.string().trim().min(8).max(12),
  connectionId: z.uuid(),
  secret: z.string().regex(/^[A-Za-z0-9_-]{43,86}$/, "The secret must be at least 32 bytes, base64url."),
  deviceName: z.string().trim().min(1).max(80).default("Flint"),
  manifestHash: z.string().max(200).optional(),
});

export const RevokeSchema = z.object({ connectionId: z.uuid() });

// Flint sends {name, address}; plain strings are accepted too.
const Address = z.union([
  z.string().max(400),
  z.object({ name: z.string().max(200).nullish(), address: z.string().max(320).optional(), email: z.string().max(320).optional() }).transform((a) => {
    const email = a.address ?? a.email ?? "";
    return a.name ? `${a.name} <${email}>` : email;
  }),
]);

export const DeliverySchema = z.object({
  messageId: z.string().trim().min(1).max(500),
  from: Address,
  to: z.union([Address, z.array(Address).max(50)]).optional(),
  subject: z.string().max(1000).default(""),
  date: z.union([z.string().max(60), z.number()]).optional(),
  text: z.string().max(500_000).nullable().optional(),
  html: z.string().max(1_000_000).nullable().optional(),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export function signDelivery(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac("sha256", Buffer.from(secret, "base64url")).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** True when the delivery carries a fresh signature made with this connection's secret. */
export function verifyDelivery(p: { secret: string; timestamp: string | null; signature: string | null; body: string; now: number }): boolean {
  if (!p.timestamp || !p.signature || !/^\d{9,11}$/.test(p.timestamp)) return false;
  const ts = Number(p.timestamp);
  if (Math.abs(p.now / 1000 - ts) > SIGNATURE_WINDOW_S) return false;
  const expected = Buffer.from(signDelivery(p.secret, ts, p.body));
  const given = Buffer.from(p.signature.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Identifies the manifest Flint approved, so a change is visible. */
export const manifestHash = (m: unknown) => createHash("sha256").update(JSON.stringify(m)).digest("hex");

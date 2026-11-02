import "server-only";
import { getDb } from "../db/client";
import { hitRateLimit } from "../db/rate-limit";

const MINUTE = 60_000;

/** Named limits: [hits allowed, window]. */
export const LIMITS = {
  login: [10, 15 * MINUTE],
  register: [5, 60 * MINUTE],
  forgot: [5, 15 * MINUTE],
  forgotEmail: [3, 60 * MINUTE],
  // Resend's free plan sends 100 a day, shared with other apps.
  forgotSentDaily: [40, 24 * 60 * MINUTE],
  reset: [10, 15 * MINUTE],
  preferences: [120, 15 * MINUTE],
  trips: [60, 15 * MINUTE],
  // Trip alerts share Resend's daily allowance with reset emails, so they get less than half.
  tripAlertsDaily: [40, 24 * 60 * MINUTE],
  journeys: [120, 15 * MINUTE],
  // Each AI call spends the traveller's own subscription; keep runaway loops short.
  journeysAi: [30, 15 * MINUTE],
  wanderlog: [10, 15 * MINUTE],
  pairCode: [10, 15 * MINUTE],
  pair: [10, 15 * MINUTE],
  // Per connection or forwarding address: a stuck sender can't fill the table.
  inboundMail: [200, 24 * 60 * MINUTE],
} as const;

/** False once `key` has used up the named limit. */
export async function allow(name: keyof typeof LIMITS, key: string): Promise<boolean> {
  const [limit, windowMs] = LIMITS[name];
  return hitRateLimit(await getDb(), `${name}:${key}`, limit, windowMs, Date.now());
}

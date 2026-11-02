import type { Queryable } from "../db/client";
import { dueTrips, recordCheck } from "../db/trips";
import type { SearchQuery } from "../types";
import { decideAlerts } from "./alerts";
import { tripLink, type TripAlert } from "./mail";

// The daily pass over saved trips: re-run each due trip's searches, record the
// best fare, and email when an alert fires. Search and email are passed in so
// the pass is tested without the network.

export type CheckDeps = {
  db: Queryable;
  today: string;
  now: () => number;
  appUrl: string;
  /** The cheapest fare for one search, or null when it found nothing or failed. */
  cheapest: (q: SearchQuery) => Promise<number | null>;
  /** False once today's email allowance is used up. */
  mayEmail: () => Promise<boolean>;
  email: (to: string, alert: TripAlert) => Promise<void>;
  /** Trips to load per run, and when to stop starting new ones. */
  batch: number;
  deadline: number;
};

export type CheckResult = { checked: number; emailed: number; skipped: number };

async function bestFare(queries: SearchQuery[], cheapest: CheckDeps["cheapest"]): Promise<number | null> {
  let best: number | null = null;
  for (const q of queries) {
    const price = await cheapest(q).catch(() => null);
    if (price !== null && (best === null || price < best)) best = price;
  }
  return best;
}

export async function checkTrips(d: CheckDeps): Promise<CheckResult> {
  const result: CheckResult = { checked: 0, emailed: 0, skipped: 0 };
  for (const trip of await dueTrips(d.db, d.today, d.batch)) {
    if (d.now() > d.deadline) {
      result.skipped++;
      continue;
    }
    const fare = await bestFare(trip.queries, d.cheapest);
    const decision = decideAlerts(trip, fare, d.today);
    let emailed = false;
    if (decision.reasons.length && (await d.mayEmail())) {
      try {
        await d.email(trip.email, { title: trip.title, reasons: decision.reasons, cheapest: fare, previous: trip.alertPrice, target: trip.targetPrice, url: tripLink(d.appUrl, trip.id) });
        emailed = true;
      } catch (err) {
        console.error(`[trips] alert email for ${trip.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
    // Only mark an alert as used once its email went out; otherwise it fires again tomorrow.
    const next = emailed ? decision.next : { alertPrice: trip.alertPrice, targetHit: trip.targetHit, reminded: trip.reminded };
    await recordCheck(d.db, trip.id, { lastPrice: fare, checkedAt: d.now(), ...next });
    result.checked++;
    if (emailed) result.emailed++;
  }
  return result;
}

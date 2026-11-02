import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { fail, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { purgeStaleBodies } from "@/lib/db/inbound";
import { bookingPage } from "@/lib/fares";
import { runSearch } from "@/lib/search";
import { env } from "@/lib/server/env";
import { allow } from "@/lib/server/limits";
import { bookedFarePrice } from "@/lib/trips/booked";
import { checkTrips } from "@/lib/trips/check";
import { sendTripAlert } from "@/lib/trips/mail";

// Vercel Cron calls this once a day (vercel.json). Each trip runs up to five
// live searches (a booked trip reads one booking page instead), so stop starting trips well before the function's limit.
export const maxDuration = 300;
const STOP_AFTER_MS = 240_000;
const BATCH = 40;

function authorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// GET /api/cron/trips: re-check saved trips and email alerts that fire.
export async function GET(req: Request) {
  // Always run per request; never prerender at build.
  await connection();
  const config = env();
  if (!authorized(req, config.CRON_SECRET)) return fail("Not allowed.", 401);
  const started = Date.now();
  try {
    const result = await checkTrips({
      db: await getDb(),
      today: new Date(started).toISOString().slice(0, 10),
      now: Date.now,
      appUrl: config.APP_URL,
      cheapest: async (q) => {
        const { itineraries } = await runSearch(q, req.signal);
        return itineraries.reduce<number | null>((m, it) => (m === null || it.price < m ? it.price : m), null);
      },
      bookedPrice: async (b) => bookedFarePrice(await bookingPage(b.tfs, req.signal), b),
      mayEmail: () => allow("tripAlertsDaily", "all"),
      email: (to, alert) => sendTripAlert(to, alert, config.RESEND_API_KEY),
      batch: BATCH,
      deadline: started + STOP_AFTER_MS,
    });
    // Forwarded mail nobody read in 30 days: drop the body (design: mail is kept only until read).
    const purged = await purgeStaleBodies(await getDb(), started - 30 * 86_400_000);
    if (purged) console.info(`[trips] dropped ${purged} unread forwarded emails`);
    console.info(`[trips] daily check: ${result.checked} checked, ${result.emailed} emailed, ${result.skipped} left for tomorrow`);
    return ok(result);
  } catch (err) {
    console.error("[trips] daily check failed:", err instanceof Error ? err.message : err);
    return fail("The trip check failed.", 500);
  }
}

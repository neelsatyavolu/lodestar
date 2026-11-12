import { jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Queryable } from "../db/client";
import { userIdForXanomSub } from "../db/xanom";
import type { XanomConfig } from "./oidc";

// GET /api/xanom/summary (spec §4): the card accounts.xanom.co shows for Lodestar.
// Counts and trip titles only: no prices, bookings or confirmation numbers.

export type Summary =
  | { linked: false }
  | {
      linked: true;
      headline: string;
      items: { label: string; value: string }[];
      recent: { title: string; url: string; at: string }[];
      url: string;
    };

/** The Xanom sub a summary request is for, or null when its token isn't a valid summary token for Lodestar. */
export async function summarySub(config: XanomConfig, authorization: string | null, jwks: JWTVerifyGetKey, now: number): Promise<string | null> {
  const token = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat"],
      currentDate: new Date(now),
      maxTokenAge: "5m",
    });
    return payload.scope === "summary" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function buildSummary(q: Queryable, sub: string, appUrl: string, now: number): Promise<Summary> {
  const userId = await userIdForXanomSub(q, sub);
  if (!userId) return { linked: false };
  const today = new Date(now).toISOString().slice(0, 10);
  const [counts] = await q.query<{ trips: number; upcoming: number; watches: number }>(
    `SELECT
       (SELECT count(*)::int FROM journeys WHERE user_id = $1) AS trips,
       (SELECT count(*)::int FROM journeys WHERE user_id = $1 AND COALESCE(end_date, start_date) >= $2::date) AS upcoming,
       (SELECT count(*)::int FROM saved_trips WHERE user_id = $1) AS watches`,
    [userId, today],
  );
  const recent = await q.query<{ id: string; title: string; updated_at: string | Date }>(
    "SELECT id, title, updated_at FROM journeys WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 3",
    [userId],
  );
  const home = new URL("/", appUrl).toString();
  return {
    linked: true,
    headline: `${plural(counts.upcoming, "upcoming trip", "upcoming trips")} · ${plural(counts.watches, "fare watch", "fare watches")}`,
    items: [
      { label: "Trips", value: String(counts.trips) },
      { label: "Upcoming", value: String(counts.upcoming) },
      { label: "Fare watches", value: String(counts.watches) },
    ],
    recent: recent.map((r) => ({
      title: r.title.slice(0, 120),
      url: new URL(`/?trip=${r.id}`, appUrl).toString(),
      at: new Date(r.updated_at).toISOString(),
    })),
    url: home,
  };
}

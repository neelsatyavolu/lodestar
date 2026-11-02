import { readPreferences, type Preferences } from "../preferences";
import type { Queryable } from "./client";
import { toTs } from "./time";

/** The account's saved preferences, or the defaults if none are saved yet. */
export async function getPreferences(q: Queryable, userId: string): Promise<Preferences> {
  const [row] = await q.query<{ data: unknown }>("SELECT data FROM preferences WHERE user_id = $1", [userId]);
  return readPreferences(row?.data);
}

export async function savePreferences(q: Queryable, userId: string, prefs: Preferences, now: number): Promise<void> {
  await q.query(
    `INSERT INTO preferences (user_id, data, updated_at) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [userId, JSON.stringify(prefs), toTs(now)],
  );
}

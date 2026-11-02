import type { Queryable } from "./client";
import { toTs } from "./time";

// An account's AI sign-ins. The value is already sealed (AES-GCM, bound to the
// account and provider) by lib/ai/session, so the database never holds a usable token.

export async function getAiConnection(q: Queryable, userId: string, provider: string): Promise<string | null> {
  const [row] = await q.query<{ sealed: string }>("SELECT sealed FROM ai_connections WHERE user_id = $1 AND provider = $2", [userId, provider]);
  return row?.sealed ?? null;
}

export async function saveAiConnection(q: Queryable, userId: string, provider: string, sealed: string, now: number): Promise<void> {
  await q.query(
    `INSERT INTO ai_connections (user_id, provider, sealed, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, provider) DO UPDATE SET sealed = EXCLUDED.sealed, updated_at = EXCLUDED.updated_at`,
    [userId, provider, sealed, toTs(now)],
  );
}

export async function deleteAiConnection(q: Queryable, userId: string, provider: string): Promise<void> {
  await q.query("DELETE FROM ai_connections WHERE user_id = $1 AND provider = $2", [userId, provider]);
}

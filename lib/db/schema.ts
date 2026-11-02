import type { Queryable } from "./client";

// Idempotent statements, run in order on every start. Later changes go at
// the end as ALTERs so existing databases catch up.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    session_version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL
  )`,
  // Reset links sent and not yet used. Only a hash of each token is kept.
  `CREATE TABLE IF NOT EXISTS password_resets (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count integer NOT NULL
  )`,
  // Saved travel preferences: one JSON document per account, validated on read and write.
  `CREATE TABLE IF NOT EXISTS preferences (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  // AI sign-ins (ChatGPT, Grok) made while signed in, sealed by lib/ai/session.
  `CREATE TABLE IF NOT EXISTS ai_connections (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider text NOT NULL,
    sealed text NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, provider)
  )`,
  // Plan shortlists saved by the traveller, with the searches a daily check re-runs for alerts.
  `CREATE TABLE IF NOT EXISTS saved_trips (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title text NOT NULL,
    prompt text NOT NULL,
    queries jsonb NOT NULL,
    snapshot jsonb NOT NULL,
    first_depart date NOT NULL,
    saved_price numeric NOT NULL,
    alert_price numeric NOT NULL,
    last_price numeric,
    checked_at timestamptz,
    alert_drop boolean NOT NULL DEFAULT true,
    target_price numeric,
    target_hit boolean NOT NULL DEFAULT false,
    remind_on date,
    reminded boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS saved_trips_user ON saved_trips (user_id, created_at DESC)`,
  // Set once the traveller books: the exact fare bought and what they paid (lib/trips/booked).
  `ALTER TABLE saved_trips ADD COLUMN IF NOT EXISTS booking jsonb`,
];

export async function migrate(db: Queryable): Promise<void> {
  for (const sql of STATEMENTS) await db.query(sql);
}

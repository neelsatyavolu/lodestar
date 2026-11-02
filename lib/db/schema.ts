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
  // The trip organizer ("journeys" here, "Trips" in the UI): trips built from mail, imports and the traveller.
  `CREATE TABLE IF NOT EXISTS journeys (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title text NOT NULL,
    destination text,
    start_date date,
    end_date date,
    source text NOT NULL,
    external_key text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS journeys_external ON journeys (user_id, external_key) WHERE external_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS journeys_user ON journeys (user_id, start_date)`,
  // Flights, stays, reservations and plans. No journey means it waits in "Needs a trip".
  `CREATE TABLE IF NOT EXISTS journey_items (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    journey_id uuid REFERENCES journeys (id) ON DELETE CASCADE,
    kind text NOT NULL,
    status text NOT NULL,
    title text NOT NULL,
    start_date date NOT NULL,
    start_time text,
    end_date date,
    end_time text,
    place text,
    confirmation text,
    dedupe_key text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    source text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS journey_items_dedupe ON journey_items (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS journey_items_journey ON journey_items (journey_id, start_date)`,
  // Mail that arrived by forwarding or through Flint. The body is kept only until it has been read.
  `CREATE TABLE IF NOT EXISTS inbound_mail (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source text NOT NULL,
    message_id text NOT NULL,
    sender text NOT NULL,
    subject text NOT NULL,
    body text,
    state text NOT NULL,
    error text,
    received_at timestamptz NOT NULL,
    UNIQUE (user_id, message_id)
  )`,
  // Each account's private forwarding address is <token>@INBOUND_DOMAIN.
  `CREATE TABLE IF NOT EXISTS journey_inboxes (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE
  )`,
  // One-time codes shown on the pairing page; only a hash is kept.
  `CREATE TABLE IF NOT EXISTS connector_codes (
    code_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  )`,
  // Flint connections, each with its delivery-signing secret sealed.
  `CREATE TABLE IF NOT EXISTS connector_links (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    sealed_secret text NOT NULL,
    device_name text NOT NULL,
    created_at timestamptz NOT NULL,
    last_delivery_at timestamptz
  )`,
];

export async function migrate(db: Queryable): Promise<void> {
  for (const sql of STATEMENTS) await db.query(sql);
}

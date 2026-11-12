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
  // The trip planner: who's going, what kind of trip, and the secret share link.
  `ALTER TABLE journeys ADD COLUMN IF NOT EXISTS travelers int`,
  `ALTER TABLE journeys ADD COLUMN IF NOT EXISTS trip_type text`,
  `ALTER TABLE journeys ADD COLUMN IF NOT EXISTS share_token text UNIQUE`,
  // A trip's checklist, notes and budget lines that aren't bookings.
  `CREATE TABLE IF NOT EXISTS journey_tasks (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    journey_id uuid NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
    title text NOT NULL,
    done boolean NOT NULL DEFAULT false,
    due date,
    section text NOT NULL,
    position int NOT NULL,
    source text NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS journey_tasks_journey ON journey_tasks (journey_id, position)`,
  `CREATE TABLE IF NOT EXISTS journey_notes (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    journey_id uuid NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
    title text NOT NULL,
    body text NOT NULL,
    position int NOT NULL,
    source text NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS journey_notes_journey ON journey_notes (journey_id, position)`,
  `CREATE TABLE IF NOT EXISTS journey_costs (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    journey_id uuid NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
    label text NOT NULL,
    amount numeric(12, 2) NOT NULL,
    currency text NOT NULL,
    category text NOT NULL,
    paid boolean NOT NULL DEFAULT false,
    source text NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS journey_costs_journey ON journey_costs (journey_id, created_at)`,
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
  // Agent access (MCP). OAuth clients: registered (id is a uuid) or described
  // by a metadata document at an https URL (id is that URL, cached here).
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    id text PRIMARY KEY,
    name text NOT NULL,
    redirect_uris jsonb NOT NULL,
    kind text NOT NULL,
    created_at timestamptz NOT NULL,
    fetched_at timestamptz
  )`,
  // Authorization codes waiting to be exchanged. Single use; only a hash is kept.
  `CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    challenge text NOT NULL,
    resource text,
    expires_at timestamptz NOT NULL
  )`,
  // One row per connected app or personal token: what the account sees and revokes.
  `CREATE TABLE IF NOT EXISTS agent_grants (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind text NOT NULL,
    client_id text,
    name text NOT NULL,
    created_at timestamptz NOT NULL,
    last_used_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_grants_client ON agent_grants (user_id, client_id) WHERE kind = 'oauth'`,
  // Access, refresh and personal tokens under a grant. Only SHA-256 hashes are kept.
  `CREATE TABLE IF NOT EXISTS agent_tokens (
    token_hash text PRIMARY KEY,
    grant_id uuid NOT NULL REFERENCES agent_grants (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind text NOT NULL,
    expires_at timestamptz,
    used_at timestamptz,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agent_tokens_grant ON agent_tokens (grant_id)`,
  // People a trip is shared with by email. The invite link's token (stored hashed) is what joins
  // them: email addresses aren't verified, so a matching address alone never grants access.
  `CREATE TABLE IF NOT EXISTS journey_members (
    id uuid PRIMARY KEY,
    journey_id uuid NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
    email text NOT NULL,
    user_id uuid REFERENCES users (id) ON DELETE CASCADE,
    can_edit boolean NOT NULL DEFAULT false,
    token_hash text UNIQUE,
    invited_at timestamptz NOT NULL,
    joined_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS journey_members_email ON journey_members (journey_id, email)`,
  `CREATE INDEX IF NOT EXISTS journey_members_user ON journey_members (user_id)`,
];

export async function migrate(db: Queryable): Promise<void> {
  for (const sql of STATEMENTS) await db.query(sql);
}

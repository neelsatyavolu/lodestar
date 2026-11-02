# Trips organizer: design

Date: 2026-11-02. The owner asked to skip the question round, so the calls below are the builder's unless marked as the owner's.

## Intent

Lodestar Trips becomes the place all of a traveller's trips live, past and upcoming: flights, hotels, dining and activity reservations, laid out day by day. Like Wanderlog, but cleaner, and trips should mostly build themselves out of the confirmations already arriving by email.

Owner's asks:

1. Trips fill in automatically from email, two ways: a **Flint connector** (Flint gains a generic connected-apps mechanism so later apps need no Flint code; Lodestar is the first app), and **forwarding** a confirmation to a Lodestar address.
2. **Import from Wanderlog**: pull in all past trips.
3. **AI help**: onboarding asks dining, activity and hotel preferences; on a trip, one button makes a custom dining plan, another makes hotel suggestions.
4. Consult other agents on the design. Done: Codex and Grok reviewed it on 2026-11-02 and agreed on the points below.

## Goals, non-goals, anti-goals

Goals: zero-typing trip creation from mail; one chronological day view; clear status for every item (booked, planned, suggested, cancelled); preferences that steer suggestions; existing fare-watch shortlists keep working.

Non-goals for v1: collaborators, expenses, maps, packing lists, two-way Wanderlog sync, iOS Flint delivery, attachment/PDF parsing (boarding passes are often images), automatic booking.

Anti-goals, failures even if the feature technically works:
- A booking silently merged into the wrong trip. An item left unfiled is better than a wrong merge.
- Mail leaving Flint that the user didn't approve.
- AI spending the user's subscription without any user action.
- Suggestions that look like bookings, or prices invented by the model.

## Data model (Lodestar Postgres)

Internally the new organizer is "journeys" so it doesn't collide with `saved_trips` (Plan shortlists with fare alerts, unchanged). The UI calls both "Trips": shortlists show as a "Watching fares" section.

- `journeys`: id, user_id, title, destination (city text), start_date, end_date (nullable), source (`manual | email | flint | wanderlog`), external_key (unique per user, e.g. `wanderlog:<key>`, for idempotent imports), created_at, updated_at.
- `journey_items`: id, user_id, journey_id (nullable: unfiled), kind (`flight | stay | dining | activity | transport | note`), status (`booked | planned | suggested | cancelled`), title, start_date, start_time (local `HH:MM`, nullable), end_date, end_time, place, confirmation, dedupe_key (unique per user, nullable), details jsonb (kind-specific: airline, flight number, airports, address, price, link, why), source, created_at, updated_at.
- `inbound_mail`: id, user_id, source (`forward | flint`), message_id (unique per user: the same mail through Flint and a forward is processed once), sender, subject, body text (cleared once parsed), state (`parsed | needs_ai | failed | ignored`), error, received_at.
- `journey_inboxes`: user_id, token (unguessable, unique): the forwarding address is `<token>@<INBOUND_DOMAIN>`.
- `connector_codes`: hash of a one-time pairing code, user_id, expires_at (10 minutes).
- `connector_links`: connection id (from Flint), user_id, sealed HMAC secret, device name, created_at, last_delivery_at.

Times are stored as local wall-clock date and time as the confirmation states them. No time-zone conversion in v1.

### Dedupe

- Flight segment: `flight:<airline><number>:<date>`. A confirmation number links segments; it is not a segment id.
- Stay: `stay:conf:<code>`, else `stay:<normalized name>:<check-in>`.
- Dining/activity/transport: `<kind>:conf:<code>`, else `<kind>:<normalized name>:<date><time>`.
- Re-ingesting updates the item's times, details and status. A cancellation sets `cancelled`. Assignment to a journey and a user's own edits to title and notes are kept.

### Grouping (pure function, `lib/journeys/group.ts`)

All items parsed from one email go together as a batch spanning their dates.
1. If any item already exists (dedupe hit) and is filed, the batch joins that journey.
2. Otherwise candidates are journeys whose dates, widened by one day each side, overlap the batch. A flight leaving a journey's destination within 30 days of its start also matches (the flight home).
3. Exactly one candidate: file there and widen its dates. None, and the batch has a flight or a stay: create a journey titled after the destination city. Anything else stays **unfiled**, shown at the top of Trips with a "Choose trip" control.

## Ingestion

All sources end in one function: `ingestMail(userId, {source, messageId, from, subject, html, text})`:
1. Insert `inbound_mail`; a duplicate `message_id` stops here.
2. Parse schema.org JSON-LD from the HTML (`FlightReservation`, `LodgingReservation`, `FoodEstablishmentReservation`, `EventReservation`, `RentalCarReservation`, `TrainReservation`, `BusReservation`, plus `@graph` and arrays). Validate every field.
3. Items found: upsert, group, mark `parsed`, drop the body.
4. None: mark `needs_ai` and keep the text (capped at 60 KB).

**AI never runs from a webhook.** When the user opens Trips with ChatGPT or Grok connected, the page reads pending mail (`POST /api/journeys/read`, at most 5 per call) on the fast model, which returns JSON validated with zod. Without AI connected, Trips shows "N forwarded emails waiting. Connect AI to read them," and each one can be deleted. The model gets the text only: no tools, no links fetched.

### Forwarding (Resend Inbound)

- Each account gets a private address `<token>@<INBOUND_DOMAIN>`, shown in Trips with a copy button and regenerable. Anyone with the address can add items, so it is a secret.
- `POST /api/inbound/resend` verifies Resend's Svix signature (`RESEND_WEBHOOK_SECRET`), takes `email.received`, maps the recipient token to an account, fetches the full content from Resend's received-email API, and calls `ingestMail`. Unknown tokens are acknowledged and dropped.
- Setup (owner): add a receiving domain in Resend, set its MX records, point a webhook at `/api/inbound/resend`, and set `INBOUND_DOMAIN` and `RESEND_WEBHOOK_SECRET`.

### Flint connector protocol v1 (owner's ask: generic, no Flint code per app)

An app publishes a manifest; Flint does everything else.

Manifest at `GET https://<app>/.well-known/flint-connector.json`:

```json
{
  "flintConnector": 1,
  "id": "co.xanom.lodestar",
  "name": "Lodestar",
  "description": "Turns travel confirmations into trips.",
  "homepage": "https://lodestar.xanom.co",
  "pairPage": "https://lodestar.xanom.co/?connect=flint",
  "pairEndpoint": "https://lodestar.xanom.co/api/connectors/flint/pair",
  "deliverEndpoint": "https://lodestar.xanom.co/api/connectors/flint/deliver",
  "revokeEndpoint": "https://lodestar.xanom.co/api/connectors/flint/revoke",
  "match": { "any": [ { "field": "from", "op": "ends_with", "value": "@united.com" } ], "schemaTypes": ["FlightReservation", "LodgingReservation"] },
  "fields": ["messageId", "from", "to", "subject", "date", "text", "html"],
  "historyDays": 365
}
```

- `match.any` uses Flint's existing `RuleCondition` shape (`field`, `op`, `value`). Flint rejects conditions that would match everything, and any `matches` pattern that is effectively `.*`. A message matches if any condition matches **or** its HTML carries JSON-LD of one of `schemaTypes`.
- `fields` is an allowlist from `messageId, from, to, subject, date, text, html`. No attachments in v1.
- Every URL is HTTPS on the manifest's own host.

Flow:
1. In Flint, Settings › Connected apps › Add, the user pastes the app URL. Flint fetches the manifest and validates it.
2. Flint runs the match against local mail from the last `historyDays` days and shows a consent sheet: the app's name and host, the fields, the rules, and "N messages from the last D days would be sent", with a few example subjects.
3. Flint opens `pairPage` in the browser. The signed-in app shows a one-time 8-character code that expires in 10 minutes. The user types it into Flint.
4. Flint makes a connection id (UUID) and a 32-byte secret, then sends `POST pairEndpoint {code, connectionId, secret (base64url), deviceName, manifestHash}`. A 2xx response stores the connection, its secret (in platform secrets) and the approved manifest snapshot.
5. Delivery: `POST deliverEndpoint` with the JSON message (allowlisted fields only) and the headers `X-Flint-Connection: <id>`, `X-Flint-Timestamp: <unix seconds>` and `X-Flint-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. The receiver rejects a timestamp off by more than 5 minutes and dedupes on `messageId`. Flint retries with backoff on network errors and 5xx, gives up after 24 hours, and stops the connection on a 401 or 410.
6. Approval freezes the manifest. Flint re-checks it daily: a narrower match applies silently; a wider one, or new fields, puts the connection on "needs approval" until the user re-approves.
7. Remove: Flint signs and sends a `POST revokeEndpoint {connectionId}`, then deletes the secret. Disconnecting in the app makes the next delivery return 401, which stops it in Flint.

On the Flint side, matching and delivery run in the desktop main process (`@flint/core` service, alongside `service/codes.ts`), off message ingest (`store/ingest.ts`), not off `new_mail`, which skips older, archived and initial-sync mail. Bodies are fetched before matching when missing. Only matching mail leaves the device. The activity log records that a push happened, never the content. iOS: later.

### Wanderlog import

Wanderlog has no public API. Its web app reads `GET /api/tripPlans/home` (the trip list) and `GET /api/tripPlans/<key>` (one trip) with the `connect.sid` session cookie. Import is one-shot:
1. In Trips, Import › Wanderlog asks for the Wanderlog session. A short guide shows where to copy `connect.sid`; Wanderlog has no password sign-in an app can use, and most accounts use Google sign-in.
2. The server uses the session for that request only and never stores it, then lists the trips with their dates.
3. The user picks trips (all are selected by default) and imports. Each becomes a journey with `external_key = wanderlog:<key>`, so importing again updates instead of duplicating. Flights, hotels (check-in/out, confirmation) and dated places become items (`booked` for flights and hotels with a confirmation, otherwise `planned`). Notes and checklists are skipped.

## AI help

Preferences gain flat fields, so the existing field-by-field fallback keeps working: `cuisines[]`, `diningBudget` (`$` to `$$$$`), `dietary[]`, `interests[]`, `pace` (`relaxed | balanced | packed`), `hotelBudget` (nightly USD, nullable), `hotelPriorities[]`. Onboarding gains one skippable page, "On the ground," before Connect AI. Travel preferences gain the same section.

On a journey (AI connected):
- **Plan dining**: the model gets the destination, dates, where they're staying, existing bookings and dining preferences, and returns one lunch and one dinner per free slot. Each suggestion has a name, neighbourhood, cuisine, price level, a one-line reason and whether to reserve. They are saved as `suggested` dining items with a Google Maps search link, and the UI says to check hours before going. The model knows restaurants but not today's hours: the wording says so.
- **Find hotels**: only when the journey has dates and a destination. Runs the live Stays search (`lib/stays`) for the destination and dates, then the model picks up to three of the returned hotels by index, with reasons drawn from the preferences. Prices shown are Stays' live prices, never the model's. They are saved as `suggested` stays.
- Suggestions have Keep (makes them `planned`) and Dismiss (deletes them). Running a button again replaces that journey's earlier suggestions of that kind.

## The Trips screen

- Top: Upcoming journeys (soonest first, with a countdown), then a "Needs a trip" strip for unfiled items, then pending-mail status, then Watching fares (existing shortlists), then Past (collapsed, newest first).
- Actions in the header: New trip (city plus dates; the title is generated), Add by email (the forwarding address), Connect Flint, Import from Wanderlog.
- A journey page: the title, dates and destination (editable), the AI buttons, then a day-by-day list. Each day shows "Staying at X" when a stay covers it, items sorted by time, and suggestions drawn dashed with Keep/Dismiss. Cancelled items are struck through. Add item: kind, title, date, time, place, confirmation.
- Design: the existing Blackletter tokens and primitives in `components/ui.tsx`.

## Security

- Every journey route checks ownership by `user_id` in SQL.
- Flint and Resend webhooks check signatures in constant time and refuse stale timestamps. Bodies are capped (1 MB).
- Connector secrets and pairing codes: the secret is sealed with the existing AES-GCM helper. Codes are stored hashed, used once, and rate-limited.
- Wanderlog sessions are never written to the database or logs.
- Mail bodies are deleted once parsed. Pending bodies are deleted after 30 days by the daily cron.

## Left to the builder

Exact copy, layout details, the AI prompts, retry counts and rate-limit numbers.

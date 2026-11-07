# Trip planner, agent access and sharing: design

Date: 2026-11-07. The owner's calls: hosted MCP **with OAuth** (works as a claude.ai / ChatGPT connector, plus personal tokens for CLIs); trips get **Overview, To book, Bookings + Budget, Checklist + Notes** next to the Itinerary, and every one of them can be filled by the traveller's connected AI or by an agent over MCP; new trips start with a **quick start plus an optional AI draft**; a trip can have a **read-only share link**. The model to beat is the owner's hand-built Thanksgiving tracker (`../thanksgiving-trip`), cleaner.

## Data model

`journeys` gains `travelers int`, `trip_type text`, `share_token text UNIQUE`.

Item `details` gains:
- `reserve` (exists): this needs booking. A `planned` item with `reserve: true` is on **To book**; marking it booked sets `status: "booked"` and a confirmation.
- `bookBy` (`YYYY-MM-DD`): reserve before this day.
- `estimate` (number): expected cost when there's no `price` yet.

New tables, all scoped by `user_id`, deleted with their trip:
- `journey_tasks`: checklist. `title, done, due date?, section text ("Before you go" default), position int, source`.
- `journey_notes`: titled notes ("How the week works", "Dietary"). `title, body, position, source`.
- `journey_costs`: budget lines that aren't an item (gas, resort fees). `label, amount, currency, category, paid, source`.

`getJourney` returns a `TripDetail = JourneyWithItems & { tasks, notes, costs }`. The list endpoint still returns `JourneyWithItems`.

Pure helpers in `lib/journeys/plan.ts` (client and server): `toBook`, `bookings`, `budget`, `nights`, `issues`, `starterTasks`. Overview issues are computed, not AI: nights without a stay, bookings past or near their book-by date, overlapping times, items outside the trip's dates.

## Operations

`lib/server/plan-ops.ts` holds every write (create trip, add/patch/remove item, tasks, notes, costs, share) taking `(db, userId, …)`, so the REST routes and the MCP tools run the same code and the same validation.

REST (session cookie):
- `GET/PATCH/DELETE /api/journeys/:id` (PATCH also takes `travelers`, `tripType`)
- `POST /api/journeys` (also `travelers`, `tripType`; seeds the starter checklist)
- `PATCH /api/journeys/items/:id` also takes `facts: { reserve, bookBy, estimate, price, url, phone }` (null clears)
- `POST /api/journeys/:id/tasks|notes|costs`, `PATCH/DELETE /api/journeys/tasks|notes|costs/:id`
- `POST /api/journeys/:id/generate {provider, part}` with `part` in `itinerary | to_book | checklist | notes | budget`: the traveller's ChatGPT/Grok fills that part. Returns `{ journey: TripDetail, added }`.
- `POST /api/journeys/:id/share {on}` returns `{ url | null }`.

## Agents (MCP + OAuth)

- `POST /api/mcp`: `mcp-handler` 2.x, wrapped in `withMcpAuth`. Tools: `list_trips`, `get_trip`, `create_trip`, `update_trip`, `delete_trip`, `add_items`, `update_item`, `remove_item`, `add_tasks`, `update_task`, `remove_task`, `set_note`, `remove_note`, `add_cost`, `remove_cost`.
- Authorization server on the same origin: RFC 8414 metadata, RFC 9728 protected-resource metadata, `/oauth/authorize` consent page (Lodestar sign-in required), `/api/oauth/token` (authorization code + PKCE S256, rotating refresh tokens), `/api/oauth/register` (dynamic registration) and Client ID Metadata Documents (https `client_id`, fetched with SSRF guards). Public clients only.
- Tokens are opaque, stored as SHA-256 hashes. Access 1 h, refresh 30 days. Personal tokens (for Claude Code, Codex) are made in the account's "Agents" panel, shown once, revocable; connected apps are listed and revocable there too.

## UI

Trip page tabs: **Overview · Itinerary · To book · Bookings · Budget · Checklist** (notes live on Overview, as in Wanderlog). The map stays on the right on wide screens. Each tab has an empty state that offers the AI ("Draft with ChatGPT") and a hand-entry path. New trip is a quick start: where, when, who, what kind; after creating, "Draft it for me" runs itinerary → to book → checklist → notes → budget one part at a time with progress.

Share: a trip header "Share" toggles a secret link. `/t/:token` renders the trip read-only (Overview, Itinerary, To book, Bookings, Checklist), without confirmation numbers, prices or the budget.

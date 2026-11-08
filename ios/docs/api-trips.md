# Lodestar API contract: Trips, saved fares, places, connectors, agents

Source of truth: the route handlers in `app/api/**`, zod schemas in `lib/journeys/input.ts`,
`lib/journeys/types.ts`, `lib/trips/*.ts`, row mappers in `lib/db/*.ts`, and the web UI in
`components/journeys/*`, `components/trips.tsx`. Read as of commit `c566e67`.

Two different things are called "trips" in the code:

| UI name | Code name | Routes | What it is |
|---|---|---|---|
| **Trips** (the organizer) | `journey` | `/api/journeys/*` | A trip with dated items (flights, stays, dining, activities, transport, notes), a checklist, notes, budget lines, share link. |
| **Watching fares** (section on the Trips screen) | `trip` / `saved_trips` | `/api/trips/*` | A saved Plan shortlist with fare alerts and an optional "bought fare". |

Swift naming suggestion: `Journey*` for the organizer, `SavedTrip*` / `FareWatch*` for `/api/trips`.

---

## 0. Conventions (apply to every endpoint below)

### Envelope
Every JSON route answers:
```json
{ "ok": true,  "data": <T> }
{ "ok": false, "error": "<user-facing sentence>" }
```
The `error` string is written for the traveller: show it as is. HTTP status is set on both
(errors use 4xx/5xx; success is 200). Decode the body even on non-2xx. If the body is not JSON
(proxy error, timeout page), show `Request failed (HTTP <status>).`; if the network is down show
`Can't reach Lodestar. Check your connection.` (the web client's exact wording, `lib/client.ts`).

Exception: `GET /api/places/photo` answers a **302 redirect** to an image (section 6.3).
`/t/{token}` is an **HTML page**, not JSON (section 9).

### Auth
- Session cookie `ls_session` (httpOnly, `SameSite=Lax`, `Secure` in production, `Path=/`, 30-day
  lifetime). Set by the account endpoints (other contract doc). Let `HTTPCookieStorage.shared`
  hold it and use one `URLSession` configured with that storage for **all** calls, including image
  loads from `/api/places/photo`.
- "Auth: required" below means: no or invalid cookie -> `401` with `error` = `"Sign in first."`
  unless another message is listed.
- **401 is ambiguous on AI routes.** `generate`, `suggest` and `read` also return 401 with
  `"Connect your ChatGPT account first."` / `"Connect your Grok account first."` when the
  traveller's AI provider isn't connected. Treat a 401 as "signed out" only when the message is a
  sign-in message (`Sign in first.`, `Sign in to see your trips.`, `Sign in to add trips.`,
  `Sign in to see saved trips.`, `Sign in to save trips.`); otherwise route to the Connect AI flow.

### CSRF / Origin
Non-GET requests with an `Origin` header whose host differs from the server are refused with
`403 "Cross-site request refused."`. URLSession sends no `Origin`, so this always passes. Do not add one.

### Request bodies
- `Content-Type: application/json`. Body must be valid JSON or `400 "Request body is not JSON."`.
- Size caps per route (bytes of the raw body); over the cap -> `413 "Request is too large."`.
  Default cap is 32,000 bytes when not listed.
- Validation errors -> `400` with the first zod issue's message. Custom messages are listed per field
  (e.g. `"Use a YYYY-MM-DD date."`); otherwise it is zod's default English text
  (e.g. `Invalid input: expected string, received undefined`, `Unrecognized key: "foo"`).
- Strings are trimmed server-side where the schema says `trim`.
- `.strict()` objects (`details`, `facts`) reject unknown keys with 400. Send only listed keys.
- PATCH semantics: omit a key = leave unchanged; send `null` = clear (where nullable).

### Value formats
| Kind | Wire format | Swift |
|---|---|---|
| ISO day | `"YYYY-MM-DD"` string (calendar day, no time zone) | `String` (or a custom `LocalDate` wrapper); never `Date` |
| Clock time | `"HH:MM"` 24-hour (`00:00`-`23:59`) | `String` |
| Timestamps (`createdAt`, `updatedAt`, `checkedAt`, `receivedAt`, `expiresAt`, `lastDeliveryAt`, `lastUsedAt`, `locatedAt`, `locateFailedAt`) | integer **milliseconds** since Unix epoch | `Int64` (or `Double`) |
| IDs | lowercase UUID strings (except share tokens, Wanderlog keys, place ids) | `String` |
| Money | JSON number, may have decimals | `Double` (or `Decimal`) |
| Currency | ISO 4217 3-letter code, uppercase on write | `String` |

Server "today" for date math is UTC. The web UI uses the device's local date
(`toLocaleDateString("en-CA")`) for countdowns, past/upcoming and deadlines; do the same on iOS.

### Rate limits
Two kinds:
- **Durable** (DB-backed, `lib/server/limits.ts`): named bucket, `[hits, window]`, keyed by a hash of
  the client IP ("per IP") or of the account ("per account"). Exceeded -> `429` with the message listed.
- **In-memory** (`rateLimited`, per IP per minute, per server instance): exceeded ->
  `429 "Too many requests. Wait a minute and try again."`.

| Bucket | Limit | Key |
|---|---|---|
| `trips` | 60 / 15 min | per IP |
| `journeys` | 120 / 15 min | per IP |
| `journeysAi` | 30 / 15 min | per account |
| `wanderlog` | 10 / 15 min | per account |
| `places` + `placesDaily` | 300 / 15 min and 3000 / 24 h | per account (both checked) |
| `pairCode` | 10 / 15 min | per account |
| `agentTokens` | 20 / 60 min | per account |
| `calendar` (in-memory) | 30 / min | per IP |

Don't retry a 429 automatically; show the message.

### Timeouts
Several routes run model calls or live searches. Server limits (`maxDuration`):
`generate` 300 s, `suggest` 300 s, `read` 300 s, `import/wanderlog` 120 s, `locate` 60 s,
`calendar` 60 s. Set `URLRequest.timeoutInterval` to at least the route's limit + 10 s for these
(the URLSession default of 60 s will cut off AI drafts). Everything else: default is fine.

---

## 1. Shared types

### 1.1 Enums
```
Kind        = "flight" | "stay" | "dining" | "activity" | "transport" | "note"
Status      = "booked" | "planned" | "suggested" | "cancelled"
Source      = "manual" | "email" | "flint" | "wanderlog" | "ai" | "agent"
TripType    = "city" | "beach" | "road" | "family" | "adventure" | "ski" | "business" | "other"
CostCategory= "flights" | "stays" | "transport" | "dining" | "activities" | "other"
Meal        = "breakfast" | "lunch" | "dinner"
PlanPart    = "itinerary" | "to_book" | "checklist" | "notes" | "budget"
Provider    = "codex" | "grok"          // display: codex -> "ChatGPT", grok -> "Grok"
MailState   = "parsed" | "needs_ai" | "failed" | "ignored"   // the list only ever returns needs_ai | failed
PlaceKind   = "dining" | "stay" | "activity"
GrantKind   = "oauth" | "personal"
```
Decode enums with an `unknown` fallback case so a new server value never breaks decoding.

Display labels the web uses:
- TripType: city "City break", beach "Beach", road "Road trip", family "Family", adventure "Adventure",
  ski "Ski", business "Work", other "Something else".
- CostCategory: flights "Flights", stays "Stays", transport "Getting around", dining "Food and drink",
  activities "Activities", other "Other".
- Item status pill: booked "Booked" (green dot), cancelled "Cancelled" (red dot, title struck through,
  grey), suggested "Idea" (accent), planned + `details.reserve` "To book" (+ " · by Nov 21" when
  `bookBy`; dot red if overdue/today, yellow if within 7 days, else yellow), planned otherwise: no pill
  ("Planned" in the detail panel).

### 1.2 `Details` (an item's kind-specific facts; every key optional)
`details` is always an object (`{}` when empty). Keys absent when unknown; never `null` in responses.

| Key | Type | Notes |
|---|---|---|
| `airline` | string <=80 | |
| `flightNumber` | string <=12 | |
| `from` | string <=80 | flights: usually a 3-letter IATA code |
| `to` | string <=80 | flights: usually a 3-letter IATA code |
| `address` | string <=240 | |
| `phone` | string <=40 | |
| `price` | number 0...1,000,000 | what it cost (booked) or a listed price |
| `currency` | string <=3 | default "USD" when absent |
| `url` | URL string <=2000 | booking/maps link |
| `cuisine` | string <=60 | |
| `priceLevel` | string <=4 | "$".."$$$$" |
| `why` | string <=400 | AI's reason for a suggestion |
| `reserve` | bool | `true` on a planned item = on the To book list |
| `bookBy` | ISO day | book before this day |
| `estimate` | number 0...1,000,000 | expected cost while unpriced |
| `meal` | Meal | |
| `rating` | number 0...5 | |
| `note` | string <=2000 | traveller's note |
| `guests` | int 1...30 | |
| `provider` | string <=80 | e.g. "Hertz", "OpenTable" |
| `placeId` | string <=300 | `"g:<google id>"` or `"osm:<type><id>"`; `g:` ids open place details |
| `lat` | number -90...90 | |
| `lng` | number -180...180 | |
| `locatedAt` | int ms | |
| `locateFailedAt` | int ms | |

### 1.3 `Item`
```
Item {
  id: string (uuid)
  journeyId: string | null       // null = "Needs a trip" (unfiled)
  kind: Kind
  status: Status
  title: string                  // 1..160
  startDate: ISO day             // always set
  startTime: "HH:MM" | null
  endDate: ISO day | null
  endTime: "HH:MM" | null
  place: string | null           // city or area, <=160
  confirmation: string | null    // <=40, show in Geist Mono
  details: Details
  source: Source
  dedupeKey: string | null       // server bookkeeping; ignore in UI
  updatedAt: int ms
}
```
Server order for a trip's items: `startDate` asc, then `startTime` asc with **no time first**, then
creation time. (The itinerary view re-sorts within a day, see 11.4.)

### 1.4 `Journey` and `JourneyWithItems`
```
Journey {
  id: string (uuid)
  title: string
  destination: string | null
  startDate: ISO day | null
  endDate: ISO day | null
  travelers: int | null          // 1..30
  tripType: TripType | null
  shareToken: string | null      // non-null = share link is on; 32 chars [A-Za-z0-9_-]
  source: Source
  createdAt: int ms
}
JourneyWithItems = Journey + { items: [Item] }
```

### 1.5 `Task`, `Note`, `Cost`, `TripDetail`
```
Task { id, journeyId, title: string(1..200), done: bool, due: ISO day | null, section: string(1..60), position: int, source: Source }
Note { id, journeyId, title: string(1..120), body: string(0..8000), position: int, source: Source }
Cost { id, journeyId, label: string(1..120), amount: number, currency: string, category: CostCategory, paid: bool, source: Source }

TripDetail = JourneyWithItems + { tasks: [Task], notes: [Note], costs: [Cost] }
```
Orders: tasks and notes by `position` then creation; costs by creation time.
Limits per trip: 300 tasks, 300 notes, 300 costs (`409 "A trip can hold 300 checklist items."` /
`"... 300 notes."` / `"... 300 budget lines."`). Per account: 500 journeys, 5000 items.

### 1.6 `MailSummary`
```
MailSummary { id: string, sender: string, subject: string, state: "needs_ai" | "failed", error: string | null, receivedAt: int ms }
```
Newest first, at most 50.

### 1.7 Places
```
LatLng      { lat: number, lng: number }
Suggestion  { id: string, name: string, secondary: string, category: string | null, kind: PlaceKind,
              location: LatLng | null, address: string | null }
              // id "g:<id>" (Google; location and address are null) or "osm:<type><id>" (OSM; carries location)
PlaceDetails{ id: string, name: string, address: string | null, location: LatLng | null, category: string | null,
              kind: PlaceKind, rating: number | null, ratingCount: int | null, priceLevel: string | null,
              phone: string | null, website: string | null, mapsUrl: string, openNow: bool | null,
              hours: [string],      // up to 7, Monday first, e.g. "Monday: 9:00 AM – 5:00 PM"
              summary: string | null,
              photos: [string] }    // up to 6 opaque names "places/<id>/photos/<ref>" for /api/places/photo
Leg         { seconds: number, meters: number }
```

### 1.8 Saved fare watch (`TripSummary`) and `Booking`
```
Booking {
  tfs: string            // regex ^[A-Za-z0-9_-]{16,2048}$ ; Google's encoding of the exact flights (Itinerary.tfs)
  seller: string         // 1..80
  isAirline: bool
  fare: string | null    // fare name, <=80, e.g. "Main Cabin"
  paid: number           // > 0, <= 1,000,000
  changes: "free" | "fee" | "none" | null
  refunds: "full" | "partial" | "none" | null
}

TripSummary {
  id: string (uuid)
  title: string          // "SFO → MAA · Dec 7 – Dec 20" (Geist Mono in the UI)
  prompt: string         // the Plan request
  savedPrice: number
  lastPrice: number | null      // latest daily check
  checkedAt: int ms | null
  alertDrop: bool
  targetPrice: number | null
  targetHit: bool               // target alert already sent
  remindOn: ISO day | null
  reminded: bool                // reminder already sent
  firstDepart: ISO day          // earliest departure (booked flight's departure once booked)
  createdAt: int ms
  booking: Booking | null
}
```

### 1.9 `Snapshot` (the saved shortlist, opaque-ish)
```
Snapshot {
  prompt: string (<=1200)
  plan: Plan
  canvas: Canvas
  options: { [ref: string (<=20 chars, e.g. "S1-2")]: { itinerary: Itinerary, search: int >= 0 } }
  hacks: [Hack & { search: string }]       // stored as given; decode leniently
  searches: [{ state: "waiting"|"running"|"done"|"error", count: int|null?, cheapest: number|null?, error: string|null? }]  // <=5
}
Plan   { understanding: string, assumptions: [string], searches: [PlannedSearch], question: string|null, needsOrigin: bool }
PlannedSearch { label, why, from: [IATA], to: [IATA], depart: ISO day, return: ISO day|null, cabin, stops, adults, bags, nearby, flexible }
Canvas { headline: string, summary: string, picks: [Pick], tips: [string], followups: [string] }
Pick   { ref: string, title: string, why: string, tradeoff: string|null,
         tag: "best"|"cheapest"|"fastest"|"comfort"|"hack"|"alternative" }
```
`Itinerary`, `Hack`, cabins/stops enums are defined in the flight-search contract (lib/types.ts,
lib/hacks.ts); reuse those Swift models. `options[*].itinerary` and `hacks[*]` are stored exactly as
the client sent them, so decode with optional fields and tolerate missing keys.

---

## 2. Trips organizer: list and create

### 2.1 `GET /api/journeys`
Auth: required (401 `"Sign in to see your trips."`). Rate limit: none.

Response `data`:
```
{
  journeys: [JourneyWithItems],   // NOT TripDetail: no tasks/notes/costs here
  unfiled: [Item],                // items with journeyId == null ("Needs a trip")
  mail: [MailSummary]             // forwarded mail waiting for AI (needs_ai) or failed
}
```
Journey order: `startDate` asc with no-date trips last, then `createdAt` asc.

### 2.2 `POST /api/journeys`
Auth: required (401 `"Sign in to add trips."`). Limit: `journeys`. Body cap 32 KB.

Body:
| Field | Type | Required | Rules |
|---|---|---|---|
| `destination` | string | yes | 1..80, letters/digits/space and `, . ' ’ ( ) -` only, else `"Use a place name, like Lisbon."` |
| `startDate` | ISO day \| null | no (default null) | |
| `endDate` | ISO day \| null | no (default null) | must be >= startDate, else `"The trip ends before it starts."` |
| `title` | string | no | 1..160, empty -> `"Give it a name."` |
| `travelers` | int \| null | no | 1..30 (`"At least one traveller."`) |
| `tripType` | TripType \| null | no | |

Server behaviour: title defaults to `"<destination>, <Mon YYYY>"` when startDate is set, else the
destination. `endDate` defaults to `startDate`. A starter checklist is added (section "Before you go":
"Check passports or IDs are valid for the trip", "Tell your bank and set up travel insurance",
"Share the plan with whoever's going", + trip-type extras; section "Packing": "Chargers, medications
and documents", + extras).

Response `data`: `{ id: string }`. Errors: `409 "You can keep 500 trips. Delete an old one first."`.

Web "Plan a trip" dialog sends `{destination, startDate, endDate: end ?? start, travelers, tripType}`
with travelers defaulting to 2. If an AI is connected, the toggle "Draft it with ChatGPT" (on by
default) plus dates makes it then run `generate` for every part in order (section 4.1) right after
the trip opens, with the optional "Anything it should know?" text (<=600) as `wishes`.

---

## 3. One trip

`:id` must be a UUID, else `404 "That trip doesn't exist."`.

### 3.1 `GET /api/journeys/:id`
Auth: required. Limit: none. Response `data`: `{ journey: TripDetail }`. 404 `"That trip doesn't exist."`.

### 3.2 `PATCH /api/journeys/:id`
Auth: required. Limit: `journeys`. Body (all optional):
`title` string 1..160 · `destination` (same rule as create) | null · `startDate` ISO | null ·
`endDate` ISO | null · `travelers` int 1..30 | null · `tripType` TripType | null.
Ordering is checked against the stored dates too: `400 "The trip ends before it starts."`.
Response `data`: `{ journey: TripDetail }`.

Web "Edit" sends all six: `{title: title || current, destination || null, startDate || null,
endDate: end || start || null, travelers, tripType}`.

### 3.3 `DELETE /api/journeys/:id`
Auth: required. Limit: none. Response `data`: `{}`. 404 `"That trip doesn't exist."`.
Deletes items, checklist, notes, budget. Web confirm: title `Delete <title>?`, button `Delete trip`,
body `Everything in it goes too: the itinerary, checklist, notes and budget.`

### 3.4 `POST /api/journeys/:id/items`  (add an item by hand)
Auth: required. Limit: `journeys`. Body cap 16 KB.

Body:
| Field | Type | Default | Rules |
|---|---|---|---|
| `kind` | Kind | required | |
| `status` | `"booked"` \| `"planned"` | `"planned"` | |
| `title` | string | required | 1..160 |
| `startDate` | ISO day | required | |
| `startTime` | "HH:MM" \| null | null | `"Use a HH:MM time."` |
| `endDate` | ISO day \| null | null | >= startDate (`"It ends before it starts."`) |
| `endTime` | "HH:MM" \| null | null | |
| `place` | string \| null | null | <=160 |
| `confirmation` | string \| null | null | <=40 |
| `details` | Details (strict) | `{}` | only keys from 1.2 |

Response `data`: `{ id: string }` (the stored item's id; may be an existing item's id when the same
booking is already in this trip). Then reload with `GET /api/journeys/:id` (the web does).
The trip's dates widen to cover the item. Errors: 404 trip, `409 "This account has too many items. Delete some old trips first."`.

Web payloads:
- Add dialog (kinds offered: activity "Something to do", dining "Restaurant", stay "Place to stay",
  flight "Flight", transport "Train, car or transfer"): `{kind, status: booked||confirmation ? "booked":"planned", title, startDate, startTime|null, endDate|null, place|null, confirmation|null}`. Stay asks check-in/out dates, no time.
- "Add a place" on a day (picked a search result): `{kind: place.kind ?? s.kind, status:"planned", title (<=160), startDate: day, endDate: kind=="stay" ? day+1 : null, place: first comma part of s.secondary or null, details: {placeId: s.id, address?, lat?, lng?, locatedAt: now ms (only with lat/lng), url: place.mapsUrl?, rating?}}`.
- "Add a place" with free text: `{kind:"note", status:"planned", title: text(<=160), startDate: day}`.

### 3.5 `PATCH /api/journeys/items/:id`
Auth: required. Limit: `journeys`. Body cap 16 KB. `:id` is the item id.
Body (all optional):
| Field | Type | Effect |
|---|---|---|
| `status` | Status | |
| `journeyId` | uuid \| null | file into a trip of the same account (else 404), or unfile |
| `title` | string 1..160 | |
| `startDate` | ISO day | |
| `startTime` | "HH:MM" \| null | |
| `endDate` | ISO day \| null | |
| `endTime` | "HH:MM" \| null | |
| `place` | string <=160 \| null | |
| `confirmation` | string <=40 \| null | |
| `note` | string <=2000 \| null | sets/clears `details.note` |
| `location` | `{placeId: string matching ^(g\|osm):[\w:.-]+$ (<=300), lat, lng, address: string<=240 \| null}` | pins the item: sets `details.placeId/lat/lng/locatedAt` (+ `address` when given), clears `locateFailedAt` |
| `facts` | strict object, all optional: `reserve: bool\|null`, `bookBy: ISO\|null`, `estimate: number\|null`, `price: number\|null`, `currency: /^[A-Za-z]{3}$/\|null` (uppercased), `url: http(s) URL<=2000 \| null`, `phone: string<=40 \| null`, `address: string<=240 \| null` | value sets the `details` key, `null` removes it |

Response `data`: `{ item: Item }`. 404 `"That item doesn't exist."`.
Non-cancelled filed items widen their trip's dates.

UI actions -> bodies (use exactly these):
| Action | Body |
|---|---|
| Keep a suggestion | `{status:"planned"}` |
| Mark booked (quick) | `{status:"booked"}` |
| Mark booked (To book dialog) | `{status:"booked", confirmation: code or null, facts: price ? {price, estimate:null} : {}}` |
| Mark cancelled | `{status:"cancelled"}` |
| Needs booking | `{facts:{reserve:true}}` |
| Doesn't need booking | `{facts:{reserve:null, bookBy:null}}` |
| Set book-by | `{facts:{bookBy: "YYYY-MM-DD" or null}}` |
| Move unfiled item to a trip | `{journeyId}` |
| Change day / time / note | `{startDate}` / `{startTime: v or null}` / `{note: v or null}` |
| Pin to a place | `{location:{placeId, lat, lng, address}}` |

### 3.6 `DELETE /api/journeys/items/:id`
Auth: required. Limit: none. `data`: `{}`. 404 `"That item doesn't exist."`.
Web: suggestions are dismissed without a confirm; others confirm `Remove <title>?` / `Remove`.

### 3.7 Checklist
- `POST /api/journeys/:id/tasks` — Auth, limit `journeys`, cap 4 KB. Body `{title: string 1..200 ("Say what to do."), due?: ISO|null (default null), section?: string 1..60 (default "Before you go")}`. `data`: `{ task: Task }`.
- `PATCH /api/journeys/tasks/:taskId` — cap 4 KB. Body any of `{title: 1..200, done: bool, due: ISO|null, section: 1..60}`. `data`: `{ task: Task }`. 404 `"That checklist item doesn't exist."`.
- `DELETE /api/journeys/tasks/:taskId` — `data`: `{}`. Same 404.

### 3.8 Notes
- `POST /api/journeys/:id/notes` — Auth, limit `journeys`, cap 12 KB. Body `{title: 1..120 ("Give the note a title."), body: string 0..8000}` (both required). A note with the same title (case-insensitive) is **replaced**. `data`: `{ note: Note }`.
- `PATCH /api/journeys/notes/:noteId` — Body any of `{title, body}`. `data`: `{ note: Note }`. 404 `"That note doesn't exist."`.
- `DELETE /api/journeys/notes/:noteId` — `data`: `{}`.

### 3.9 Budget lines
- `POST /api/journeys/:id/costs` — Auth, limit `journeys`, cap 4 KB. Body `{label: 1..120 ("Say what it's for."), amount: number 0..1,000,000, currency?: 3 letters (default "USD", "Use a currency code, like USD."), category?: CostCategory (default "other"), paid?: bool (default false)}`. `data`: `{ cost: Cost }`. Web sends `currency` = the budget's main currency.
- `PATCH /api/journeys/costs/:costId` — Body any of `{label, amount, currency, category, paid}`. `data`: `{ cost: Cost }`. 404 `"That budget line doesn't exist."`.
- `DELETE /api/journeys/costs/:costId` — `data`: `{}`.

For 3.7-3.9 child routes, an id that isn't a UUID returns `404 "That trip doesn't exist."` (shared
guard); a UUID that isn't found returns the specific message.

### 3.10 `POST /api/journeys/:id/share`
Auth, limit `journeys`, cap 1 KB. Body `{on: bool}`.
`data`: `{ url: string | null }` — `"<APP_URL>/t/<token>"` when on, `null` when off.
Turning on keeps an existing token; off then on makes a new one (old link dies). Update the local
`shareToken` from the URL's last path segment. To show the link for a trip already shared, build
`<baseURL>/t/<journey.shareToken>`.
Web copy: "Anyone with the link can see the plan: the days, what's booked and what still needs
booking, the checklist and notes. Confirmation numbers, prices and the budget stay private." Toggle
label "Link is on"/"Link is off"; when on: "Turn the link off to stop it working. A new link is made
if you turn it on again."

### 3.11 `GET /api/journeys/:id/legs?date=YYYY-MM-DD`
Drive time between consecutive stops on one day. Auth required; Places limit applies once there are
2+ stops. Bad date -> `400 "Pick a day."`.
`data`: `{ legs: [{ from: itemId, to: itemId, leg: Leg | null }] }` — `[]` with fewer than 2 stops;
at most 12 legs. Stops = that day's items that are pinned (lat/lng), not cancelled, not suggested,
not flight, not note, in itinerary order (11.4). `leg: null` = no route found.
Call it when a day has 2+ stops and re-call when that set of stops or their pins change.

### 3.12 `POST /api/journeys/:id/locate`
Pins items that came from email/imports. Auth required; Places limit applies when there is work.
Body: `{}` (ignored). Up to 12 lookups per call, ~35 s budget.
`data`: `{ journey: TripDetail | null, located: int, settled: int, remaining: int }`.
Web loop (do the same, once per trip open, after the full trip loaded, and only if some item
"needs location" per 11.6): call up to 6 times; after each, replace the trip's items with
`journey.items`; stop when `remaining == 0` or `settled == 0`. Ignore errors silently.

### 3.13 `DELETE /api/journeys/mail/:mailId`
Forget a waiting/failed forwarded email. Auth required. `data`: `{}`. 404 `"That email is already gone."`.

---

## 4. AI on a trip (traveller's own ChatGPT/Grok)

Check whether a provider is connected with the AI status endpoint (Plan/AI contract). Pass the
connected provider as `provider`. All three routes: limit `journeysAi` (`429 "That's a lot of AI calls. Try again in a few minutes."`),
provider not connected -> `401 "Connect your ChatGPT account first."` (or Grok), model failure -> `502` with the model's message.

### 4.1 `POST /api/journeys/:id/generate`
Body (cap 4 KB): `{provider: Provider ("Unknown provider."), part: PlanPart, wishes?: string <=600}`.
Preconditions: `400 "Give the trip a destination first."`, `400 "Give the trip dates first."`.
`data`: `{ journey: TripDetail, added: int }` — replace the whole local trip with `journey`.
`422 "The AI didn't come back with anything usable. Try again."` when nothing could be used.
What each part does: `itinerary` adds day items; `to_book` flags existing items (`reserve`, `bookBy`)
and may add items; `checklist` adds tasks; `notes` writes notes (same-title replaces); `budget` sets
`estimate` on items and **replaces** earlier AI cost lines (manual/paid ones stay).
Takes 30-90 s.

UI (`ai-draft.tsx`): one part at a time; while running show `<doing>… <n>s` and after 20 s add
" · this usually takes under a minute"; on success notice `Added <n> from ChatGPT. Edit or remove anything.`
or `ChatGPT had nothing new to add.`; on HTTP 404 show `AI drafting isn't available on this server yet. Add things by hand for now.`
Parts table: itinerary "Days"/"Drafting the days"/"Draft the days"; to_book "To book"/"Finding what to book"/"Find what to book";
checklist "Checklist"/"Writing the checklist"/"Write a checklist"; notes "Notes"/"Writing notes"/"Write notes";
budget "Budget"/"Estimating costs"/"Estimate costs".
Full draft (after "Create and draft"): runs all five in that order; a progress card shows 5 segments
(done = accent, running = pulsing, failed = red with retry once finished); headline
`Drafting the days… 1/5`, finally `ChatGPT drafted <done> of 5 parts. Look it over and change anything.`

### 4.2 `POST /api/journeys/:id/suggest`
Body (cap 32 KB): `{provider, kind: "dining" | "hotels"}`.
Replaces this trip's earlier suggestions of that kind (dining items / stay items with status `suggested`)
with fresh ones. `data`: `{ journey: TripDetail }` (web merges only `items`).
Errors: `400 "Give the trip dates first."`; hotels: `400 "Give the trip a destination and dates first."`,
`400 "Hotel picks work for stays up to 30 nights."`, `400 "The hotel search found nothing for these dates."`;
`502 "The AI answer was not in the expected shape. Try again."`, `502 "The AI didn't come back with anything usable. Try again."`; fares-service errors pass through (503 etc.).
Hotel suggestions: `kind:"stay", status:"suggested"`, trip's dates, `details: {price (live, USD, rounded), currency:"USD", why?, rating?, url}`.
UI: Itinerary tab buttons "Plan meals" (needs dates) and "Find hotels" (needs dates + destination);
while running: "Planning meals around your days…" / "Searching live hotel prices…".

### 4.3 `POST /api/journeys/read`
Reads forwarded mail that had no machine-readable booking. Auth required (no trip id). Body `{provider}`.
Reads up to 3 waiting emails per call.
`data`: `{ read: int, filed: int, error: string | null }` (`error` set when the model failed after reading some).
Web loop when the Trips screen opens with an AI connected and `mail` has `needs_ai` entries (once
per provider): call up to 4 rounds, sum `filed`, stop when `read == 0` or `error != null`; then
reload `GET /api/journeys`. Notice: `Added <n> booking(s) from your email.` or the error.

---

## 5. Imports and connectors

### 5.1 `POST /api/journeys/import/wanderlog`
Auth required. Limit `wanderlog` (`429 "Too many imports. Try again in a few minutes."`). Cap 32 KB.
Body: `{session: string 10..800 ("Paste your Wanderlog session."), keys?: [string matching ^[A-Za-z0-9_-]{4,64}$] (<=50)}`.
`session` is the wanderlog.com `connect.sid` cookie value (`s%3A…`, `s:…` or `connect.sid=…`); never stored.
- Without `keys`: `data` = `{ trips: [WanderlogTrip] }`, `WanderlogTrip { key: string, title: string, startDate: ISO|null, endDate: ISO|null, places: int }`, newest start first.
- With `keys`: imports those (unknown keys skipped, max 50; re-import updates the same trip). `data` = `{ imported: int }`.
Errors: `400 "That doesn't look like a Wanderlog session. Copy the connect.sid value."`,
`400 "Wanderlog didn't accept that session. Copy a fresh one and try again."`, `502 "Couldn't reach Wanderlog. Try again in a moment."`,
`409 "That would go past the trip limit. Import fewer at once."`.
UI: list with checkboxes, then import; success notice `Imported <n> trip(s) from Wanderlog.`;
failure fallback `The import didn't finish. Try again; trips already imported won't be doubled.`

### 5.2 `GET /api/connectors`
Auth required. `data`:
```
{ address: string | null,               // "<24 chars>@<inbound domain>"; null = forwarding not set up on this server
  flint: [ConnectorLink] }              // ConnectorLink { id: uuid, deviceName: string, createdAt: int ms, lastDeliveryAt: int ms | null }, oldest first
```
Calling it creates the address on first use.

### 5.3 `POST /api/connectors/address`
New forwarding address; old one stops working. Auth, limit `journeys`. Body `{}`.
`data`: `{ address: string }`. `404 "Forwarding isn't set up on this server."`.
Web confirm: `Make a new address?` / `Make new address` / `Mail sent to the old one will stop reaching Trips.`

### 5.4 `POST /api/connectors/flint/code`
One-time pairing code (replaces any previous). Auth, limit `pairCode` (`429 "Too many codes. Try again in a few minutes."`). Body `{}`.
`data`: `{ code: "XXXX-XXXX", expiresAt: int ms }` (valid 10 minutes, single use).
Flint dialog steps: 1. "In Flint, open Settings › Connected apps › Add app and paste:" `<baseURL>` (copy button).
2. "When Flint asks for a code, type this one. It works once, for 10 minutes." Then a "Connected" list:
`<deviceName> · last sent <date>` or `· nothing sent yet`, each with "Disconnect".

### 5.5 `DELETE /api/connectors/flint/:linkId`
Auth. `data`: `{}`. `404 "That connection is already gone."`.

### 5.6 Machine-only routes (do NOT call from the app)
`POST /api/connectors/flint/pair`, `/deliver`, `/revoke` (HMAC-signed by the Flint Mac app),
`GET /.well-known/flint-connector.json`, `POST /api/inbound/resend` (email webhook), `GET /api/cron/trips` (daily check).

---

## 6. Places

All three need sign-in (except the empty-query shortcut) and share the `places` limits
(`429 "That's a lot of searching. Try again in a few minutes."`). Google errors: `502 "Couldn't reach Google Maps. Try again."`,
`502 "Google Maps didn't answer. Try again."`, `404 "That place wasn't found."`.

### 6.1 `GET /api/places/search?q=&lat=&lng=&session=`
- `q`: trimmed, truncated to 120. Under 2 chars -> `{suggestions: [], provider}` without auth.
- `lat`,`lng`: optional bias point (both needed, valid ranges); use the trip's search center (11.7).
- `session`: optional `[A-Za-z0-9-]` <=64; one UUID per search box session (Google bills per session).
`data`: `{ suggestions: [Suggestion] (<=6 for Google), provider: "google" | "osm" }`.
Web: debounce, new session UUID when the box opens, reuse it for every keystroke and for the details
call of the picked row, then drop it.

### 6.2 `GET /api/places/details?id=g:<id>&session=`
`id` must match `^g:[A-Za-z0-9_-]{10,300}$` and Google must be configured, else `404 "No details for this place."`.
`data`: `{ place: PlaceDetails }`. Cached 5 min (`private, max-age=300`). Only call for `g:` ids;
OSM places have no details. Web caches per placeId for the session and loads stop-card details only
when the card scrolls near view.

### 6.3 `GET /api/places/photo?name=places/<id>/photos/<ref>&w=<px>`
`w` clamped 100..1200 (default 640). Success: **302** to a short-lived Google image URL (no key in it),
`cache-control: private, max-age=3000`. Errors are JSON envelopes (`404 "No photo."`, 401, 429).
Load with the cookie-bearing session; follow the redirect. Web widths: stop card 320, panel/cover 800.

---

## 7. Saved fare watches (`/api/trips`) and the bought fare

### 7.1 `GET /api/trips`
Auth (401 `"Sign in to see saved trips."`). `data`: `{ trips: [TripSummary] }`, newest `createdAt` first.

### 7.2 `POST /api/trips`  (save a Plan shortlist; called from the Plan screen)
Auth (401 `"Sign in to save trips."`). Limit `trips`. Cap 400,000 bytes.
Body:
```
{ snapshot: Snapshot,                         // as in 1.9; searches default [], hacks default []
  searches: [PlannedSearch] (1..5),           // = snapshot.plan.searches
  filters?: { alliances?: ["STAR_ALLIANCE"|"ONEWORLD"|"SKYTEAM"] (<=3), avoidAirlines?: [2-char code] (<=20),
              preferAirlines?: [2-char code] (<=10), noBasicEconomy?: bool, avoidRedEyes?: bool, avoidSelfTransfer?: bool },
  price: number (>0, <=1,000,000) }           // web: min of searches' cheapest, else min option price
```
`data`: `{ id: string }`. `409 "You can keep 20 saved trips. Delete one in Trips first."`. Search
validation errors (e.g. `"Return is before departure."`) come back as 400.

### 7.3 `GET /api/trips/:id`
`data`: `{ snapshot: Snapshot }`. 404 `"That trip doesn't exist."`. Fetched lazily when the card's
shortlist is opened.

### 7.4 `PATCH /api/trips/:id`  (alerts)
Limit `trips`. Body: at least one of `{alertDrop: bool, targetPrice: number(>0) | null, remindOn: ISO | null}`
(empty -> `400 "Nothing to change."`). Setting `targetPrice` resets `targetHit=false`; setting
`remindOn` resets `reminded=false`. `data`: `{ trip: TripSummary }`.

### 7.5 `DELETE /api/trips/:id`
`data`: `{}`. Web confirm: `Delete <title>?` / `Delete` / `Its alerts stop too.`

### 7.6 `PUT /api/trips/:id/booking`  (mark booked: "bought fare")
Limit `trips`. Body: `Booking` (1.8). `tfs` must equal `options[*].itinerary.tfs` of one of the
trip's saved options, else `404 "That itinerary isn't on this trip's shortlist."`.
Server: alerts now watch that exact fare from that seller against `paid`; `alertDrop=true`,
target and reminder cleared, `lastPrice`/`checkedAt` reset, `firstDepart` = booked flight's departure day.
`data`: `{ trip: TripSummary }`.
How the web builds it: from the shortlist's "Book" action on an itinerary with a non-null `tfs`,
after the seller check (`/api/sellers`, flight contract): `{tfs: it.tfs, seller: seller.name, isAirline: seller.is_airline, fare: fare.name, paid: fare.price, changes: fare.policy.changes if in ["free","fee","none"] else null, refunds: fare.policy.refunds if in ["full","partial","none"] else null}`;
the "Mark as booked" dialog lets the traveller edit `paid` (must be > 0: `"Enter what you paid in dollars, like 1500."`), button "Watch this fare".

### 7.7 `DELETE /api/trips/:id/booking`
Back to watching the shortlist from `savedPrice`. `data`: `{ trip: TripSummary }`.

### 7.8 Credit verdict (compute client-side, from `lib/trips/booked.ts`)
`fareWord = fare != null ? "The <fare>" : "This"`:
1. `refunds == "full"` -> claim yes: `<fareWord> fare is refundable, so you can cancel for a refund and rebook at the lower price.`
2. else `changes == "free"` -> yes: `<fareWord> fare has no change fee, so you can usually rebook the same flights at the new price and keep the difference as travel credit.`
3. else `changes == "fee"` -> maybe: `<fareWord> fare allows changes for a fee, so rebooking only pays off when the drop is bigger than the fee.`
4. else `changes == "none"` -> no: `<fareWord> fare doesn't allow changes, so you can't get the difference back.`
5. else unknown: `Google didn't list the change rules for <fare != null ? "the <fare>" : "this"> fare.` + (fare matches /basic/i ? ` Basic fares often can't be changed.` : "") + ` Check them with <seller> before you rebook.`
If `!isAirline && claim != no`, append ` You booked through <seller>, so the change goes through them, not the airline.`

### 7.9 Alert rules (for copy only; the server runs them daily)
A drop emails when the fare is at least max($10, 3%) below the last alert price. Alerts stop once
`firstDepart <= today`. Card UI (`components/trips.tsx`):
- Title (mono) + prompt (one line). Right: `Now $X` if `lastPrice`, else `Paid $X` if booked, else
  `Saved at $X`; plus the change vs base (`paid` when booked, else `savedPrice`): `−$N` in green when
  lower, `+$N` muted when higher, hidden when 0 or no lastPrice. Under it: `Checked <Sat, Nov 21>` or
  `First check within a day`. Money format: `$` + whole dollars with thousands separators.
- Booked: `Booked <fare> with <seller> for $X. Undo` and the verdict text (hidden after departure).
- Departed: `This trip has departed, so its alerts are off.`
- Booked and not departed: one toggle `Email me if this fare drops below what I paid` (alertDrop).
- Not booked: toggle `Email me when it drops`; `Under $ [target]` (saved on submit/blur; empty = null;
  must be > 0: `Enter a price in dollars, like 1500.`), `sent` when targetHit; `Remind me on [date]`
  (min today, max firstDepart; clear = null), `sent` when reminded.
- `Show shortlist`/`Hide shortlist` loads the snapshot and shows the read-only Plan canvas with
  "Prices as of when you saved it. Check a fare before booking." Booking from it is offered only when
  not booked and not departed.
- Empty state (standalone page only): `No saved trips yet. Ask Plan for a trip, then press Save trip and get alerts on the shortlist. Open Plan`.
  Embedded in Trips: the "Watching fares" section is hidden entirely when there are none. Section header
  `Watching fares` + `Shortlists saved from Plan. Lodestar checks their fares daily and emails you when an alert fires.`

---

## 8. Calendar (`POST /api/calendar`)
Lowest fare per departure day. **Auth: not required.** Limit: in-memory 30/min/IP. Cap 32 KB.
Body = a flight `SearchQuery` (flight contract: `from`, `to`, `depart`, `return`, `cabin`, `stops`,
`adults`, `children`, `bags`, `nearby`, `flexible`, `split`, preferences...) plus optional
`window: {start: ISO, end: ISO}` (the picker's visible months).
Range: `window` or `depart ± 3 days`, clipped to start no earlier than tomorrow and at most 62 days.
Round trips keep the same trip length; same-day round trips return `[]`.
`data`: **an array** `[{ depart: ISO, return: ISO | null, price: number }]` (not wrapped in an object).
Errors: `400 "From and to are the same place."`, `400 "That departure date has passed."`, fares-service 5xx messages.

---

## 9. Share link page `/t/{token}` (HTML, no JSON)
`GET <baseURL>/t/<token>` (token `^[\w-]{32}$`) renders a public read-only page, no sign-in, 404 page
once sharing is off. There is **no JSON endpoint** for it. In the app: offer the URL through the
share sheet / copy, and open it in `SFSafariViewController` when tapped. What it shows (so the owner
knows): items except suggestions, with confirmation numbers, `price`, `estimate`, `currency`,
`locatedAt`, `locateFailedAt` removed; tasks; notes; title, destination, dates, travelers. No budget.

---

## 10. Agents (`/api/agents`)

### 10.1 `GET /api/agents`
Auth. `data`: `{ mcpUrl: string ("<APP_URL>/api/mcp"), grants: [Grant] }`, newest first.
`Grant { id: uuid, kind: "oauth" | "personal", clientId: string | null, name: string, createdAt: int ms, lastUsedAt: int ms | null }`.

### 10.2 `POST /api/agents`
Personal token. Auth. Limit `agentTokens` (`429 "Too many new tokens. Try again later."`). Cap 1 KB.
Body `{name: string 1..60 ("Name the token, like Codex on my laptop.")}`.
`data`: `{ grant: Grant, token: string }` — `token` (prefix `lsp_`) is shown once only:
"Copy it now. It won't be shown again." `409 "You can have 50 connections. Revoke one first."`.

### 10.3 `DELETE /api/agents/:id`
Auth. `data`: `{}`. `404 "That connection doesn't exist."`.
Screen copy: Claude Code command `claude mcp add --transport http lodestar <mcpUrl>` then "Then run /mcp and sign in when it asks.";
other clients: "Use OAuth if the client supports it. Otherwise make a personal token below and send it as `Authorization: Bearer lsp_…`."; empty list: "Nothing connected yet."
`/api/mcp`, `/api/oauth/*` are for external agents; the app never calls them.

---

## 11. Client-side derivations the screens need (port from lib/journeys/plan.ts, locate.ts, components/journeys/shared.ts)

"live" item = status not `cancelled` and not `suggested`. `when(i)` = `"<startDate> <startTime ?? "99:99">"`.

### 11.1 To book
`items.filter(status == "planned" && details.reserve == true)` sorted by `(details.bookBy ?? startDate)`, then `when`.

### 11.2 Bookings groups
Order `flight, stay, transport, activity, dining`; items with status `booked` or `cancelled` of that kind,
sorted by `when`; empty groups dropped. Labels: Flights, Stays, Cars and transfers, Activities, Restaurants.

### 11.3 Budget
For each live item: currency = `(details.currency ?? "USD").uppercased()`;
booked with `price` -> paid entry; else with `estimate` -> estimated; else planned with `price` -> estimated.
Category from kind: flight->flights, stay->stays, transport->transport, dining->dining, activity->activities, note->other.
Plus every Cost (paid or estimated by `paid`). Main currency = the most frequent currency (ties: first seen; none: USD).
Sum only main-currency entries into lines in category order flights, stays, transport, dining, activities, other.
`total = paid + estimated`; `perPerson = travelers > 1 ? round(total / travelers) : null`;
`otherCurrencies` = other currencies seen (named, not converted).

### 11.4 Itinerary order within a day
`byItinerary`: key `startDate + (startTime ?? (kind == stay ? "99:99" : "98:00"))` ascending.

### 11.5 Days of a trip
Every day from startDate to (endDate ?? startDate), capped at 60, plus any item's startDate; sorted.
No startDate and no items = empty.

### 11.6 Needs location (drives `locate`)
Not cancelled, not note, `locateFailedAt` older than 7 days (or absent), and either no lat/lng, or a
`g:` placeId with `locatedAt` older than 30 days. Transport items without `address` are skipped.

### 11.7 Search center for "Add a place" on a day
Pinned, non-cancelled items. Prefer non-flight items on that day (stays count when the day is within
start..end), averaged; else all non-flight pinned items; else the first pinned flight in itinerary order.

### 11.8 Nights and issues ("To sort out")
Nights: for each night d in [startDate, endDate) find a booked/planned stay with `startDate <= d < (endDate ?? startDate)`;
merge consecutive nights with the same stay (or none) into runs `{from, to, nights, stay}`.
Issues (none once `endDate < today`):
- each run without a stay: warn `No place to stay for the night of <Nov 21>.` or `No place to stay for <n> nights, <Nov 21> to <Nov 24>.`
- each to-book item: bookBy past -> warn `<title> was to be booked by <Nov 21>.`; bookBy within 7 days -> `Book <title> by <Nov 21>.`;
  no bookBy and starts within 14 days -> `<title> on <Nov 21> isn't booked yet.` (these link to the item)
- two live non-stay items at the same date+time: `<A> and <B> are both at <HH:MM> on <Nov 21>.`
- days in the trip with no live non-stay item: info `Nothing planned yet on <Nov 21, Nov 22>.`

### 11.9 Text helpers
- dateRange: `Mar 1 – Mar 10, 2027`; same/no end `Mar 1, 2027`; no start `Dates not set`.
- countdown (device local today): before start `In <n> days` / `Tomorrow`; during `Day <k> of <n>`; else none.
- isPast: `(endDate ?? startDate) < today`.
- tally (live items, excluding notes): `2 flights · 1 stay · 3 reservations · 1 plan · 1 transfer` (dining = reservation(s), activity = plan(s), transport = transfer(s)); none -> `Nothing booked yet`.
- deadline(bookBy): past -> `Was due <Nov 21>` (red); today -> `Book today` (red); <=7 days -> `Book by <Nov 21>` (yellow); later -> `Book by <Nov 21>` (no tone).
- time12: `19:05` -> `7:05 PM`. timeRange: no start -> none; stays or no end -> start only; same day `7:00 PM – 9:00 PM`;
  next day appends ` +1`; later -> `7:00 PM – Tue, Nov 24, 9:00 AM`.
- amount: currency formatting, whole amounts without cents (`$1,240`, `€30.50`).
- travellers: `1 traveller` / `<n> travellers`.
- daySummary: that day's live non-stay non-note items by `when`, flights as `Fly in` (first day), `Fly home` (last day), else `Fly to <details.to>` or title; de-duplicated, comma-joined.
- Leg label: `36 min · 23.7 mi` (minutes min 1; `1 hr 5 min`; miles 1 decimal under 99.95, else whole); walking icon under 1000 m.
- Day colours (per distinct item startDate, sorted, cycling): `#4C8DFF, #F59E0B, #16A34A, #E5484D, #8B5CF6, #06B6D4, #EC4899, #84CC16`; pin numbers count pinned, non-cancelled items within a day in itinerary order.

---

## 12. Screens to mirror (web behaviour)

### 12.1 Trips home (`components/journeys/journeys.tsx`)
Hero `Trips` (Geist Serif) + "Plan any trip day by day, with what to book, a checklist and a budget. Forward a confirmation or connect Flint and bookings file themselves."
Actions: `Plan a trip` (primary), `Add by email`, `Connect Flint`, `Wanderlog`. Order of sections:
1. error / notice line; `Loading…`.
2. Mail card when `mail` has entries: waiting count line (reading: spinner `Reading <n> email(s) with your AI…`; AI connected: `<n> email(s) are waiting to be read. Read now`; not connected: `<n> email(s) have no booking details built in. Connect ChatGPT or Grok to read them.`), then each email `subject (or "(no subject)") · sender` with failed ones in red `· <error ?? "Couldn't be read">`, and a delete button (3.13).
3. `Needs a trip` (unfiled items): "These didn't clearly belong to one trip. Choose where they go." each row with a `Move to…` trip picker (3.5 `{journeyId}`), then reload.
4. No journeys: three cards — "Forward a confirmation" / "Send any flight, hotel or restaurant email to your private address." / "Get the address"; "Connect Flint" / "New travel mail files itself, and the last year's comes in when you connect." / "Connect"; "Bring Wanderlog trips" / "Import past and upcoming trips with their flights, hotels and plans." / "Import".
5. `Upcoming` (not past, server order): card with title, countdown (accent), dateRange, travellers, tally, `<n> to book · next by <Nov 21>` (tone of the first to-book's deadline), `Next: <title> at <7:00 PM>` (first booked/planned item on or after today).
6. `Watching fares` (section 7.9).
7. `Past trips (<n>)` collapsed, most recent first: title + dateRange rows.

### 12.2 Trip page (`journey-detail.tsx`)
Open from list data, then immediately `GET /api/journeys/:id` for tasks/notes/costs; run `locate` loop (3.12).
Cover: destination photo (first `g:` suggestion for the destination -> its first photo), title, dateRange,
travellers, trip type label, countdown; buttons Edit, Share (emphasised when shared), Delete; Back.
Tabs (order, ids): Overview `overview`, Itinerary `itinerary`, To book `book` (badge = to-book count when > 0),
Bookings `bookings`, Budget `budget`, Checklist `checklist` (badge `done/total` when tasks exist).
Default tab Overview (Itinerary right after "Create and draft"). Default active day: first day >= today, else first.
Map (MapKit on iOS): pinned items, day colours, numbered; on the Itinerary tab it focuses the active day.
Selecting a stop opens the place panel (sheet on phone) with a pager "k of n" through that day's
live non-note items in itinerary order.

### 12.3 Overview tab
- Reservations card: count link `<booked> booked · <n> to book` (opens Bookings); six add buttons with
  booked counts: Flight, Stay, Rental car (transport preset title "Rental car"; counts transport whose
  title/provider matches car|rental|hertz|avis|alamo|enterprise|national|budget|sixt), Transport (other transport), Activity, Dining.
- Budget card: total (or `$0`), `<paid> paid · <per person> each` or `Nothing priced yet`, `View details`.
- `To sort out` (only when issues exist; badge = warn count; rows with an item link show `Open`).
- `Notes` (menu: Add a note, Write notes with AI).
- `Hotels and lodging` (when nights exist; aside `<n> nights`): each run: stay title + `place · Booked` or `Planned, not booked`, dates and nights; gaps dashed `No stay yet` / `Add a place to stay`.
- `Places to visit`: activity/dining items that are suggested, or planned without a time. Empty: "Ideas without a time land here: places to eat and things to do you might fit in." + `Suggest places`.

### 12.4 Itinerary tab
Head `Itinerary` / "Click a stop for details. Numbers match the map." (with dates). Actions: Add, AI
(`Fill gaps with AI` if any non-flight non-stay non-cancelled item exists, else `Draft the days`), Map (phone).
`Plan meals`, `Find hotels` (4.2). `Hotel ideas` section: suggested stays (Keep / Dismiss / See prices; "From $X a night on today's search · rated R").
No days: empty state "Add dates to plan day by day" / "Once the trip has dates, each day gets its own list, and your AI can draft them." + `Add dates`.
Days but nothing planned: "The days are empty" / "Your AI can draft a day-by-day plan around what's already booked and what you like. Or add places to each day below."
Each day (collapsible): coloured dot + `Saturday, November 21`; sub `Day <n> · <daySummary>` (`Nothing planned` when folded and empty); total driving (sum of legs) `1 hr 5 min`.
Content order: stays you wake up in (`startDate < day <= endDate`), firm items (non-suggested, non-stay, by itinerary order; notes as note cards), with a leg row between consecutive stops (`36 min · 23.7 mi`, `Directions` to Google Maps), stays you check into that day (`Check in 3:00 PM` / `Check out 11:00 AM`), then `Ideas for this day` (suggested, Keep/Dismiss). Footer `Add a place` (or `Nothing planned yet. Add a place`).
Stop card: pin, title, status pill, sub `category/cuisine · address or place · Conf. <code>` (no address for flights), note or why, time chip, flight `SFO → NRT`, Google photo; menu: Needs booking / Doesn't need booking (planned), Mark booked (planned), Mark cancelled (booked), Remove.
Footer note when dining suggestions exist: "Meal ideas come from the AI's knowledge, not live listings. Check hours and book ahead."

### 12.5 To book tab
Head sub: `<n> to reserve, <k> past due. Soonest deadline first.` or "Restaurants, tours, spa slots, cars: anything that needs a reservation."
Card: title, `Sat, Nov 21 · 7:00 PM – 9:00 PM · address`, deadline text (or `No deadline`), `about $X` from estimate, note/why; `Mark booked` (dialog: Confirmation number (optional, mono, <=40), What you paid (optional, "Goes into the budget as paid.")), `Reserve` link (details.url), phone (tel:), Book-by date picker, X = doesn't need booking.
Empty: "Nothing to book yet" / "Your AI can go through the itinerary and flag what needs a reservation and by when. You can also mark any planned stop as needing booking from the Itinerary." + AI button. With items: `Check for more`.

### 12.6 Bookings tab
Sub `<n> confirmed. Forward a confirmation email and it lands here.` Groups (11.2); row: title (struck if cancelled), `when · provider/airline · Cancelled`, price, confirmation copy chip (mono) or `No number`.
When: stays `Nov 21 – Nov 24`; multi-day non-flight `Sat, Nov 21 9:00 AM → Tue, Nov 24 5:00 PM`; else `Sat, Nov 21 · <timeRange>`.
Empty: "No bookings yet" / "Forward confirmation emails to your Lodestar address, connect Flint, or add one by hand. Things you mark booked on To book show up here too." + `Add booking`.

### 12.7 Budget tab
Table Category / Paid / Estimated (`~$X`, `—` when 0) / Total, footer `All in`; `About $X per person for <n> travellers.` or "Set how many are going in Edit to see a per-person figure." Sub mentions uncounted currencies.
`Other costs` (costs list: paid checkbox (optimistic PATCH `{paid}`), label, `category · AI estimate | · added by an agent`, `~` prefix when unpaid, delete) + add form (label "Gas, tips, resort fee", category, amount).
`From your plan`: live items with price or estimate (`category · paid|estimate`).
Empty (total 0): "No costs yet" / "Prices from your bookings add up here on their own. Your AI can estimate the rest: meals, activities, gas, fees." With costs: `Re-estimate`.

### 12.8 Checklist tab
Sub `<done> of <total> done`, accent progress bar; sections in first-appearance order; row checkbox (optimistic PATCH `{done}`), title (struck when done), `by <Nov 21>` with deadline tone when not done, delete. Add form: title + section (suggest existing sections; default "Before you go").
Empty: "Nothing on the checklist" / "Documents, reservations to make, what to pack. Your AI can write one for this trip, or start your own below."

### 12.9 Place panel
Google part when `placeId` starts with `g:` (6.2): tabs About / Reviews / Photos; open now/closed now, hours, rating, price level, phone, website; "Open in" Google Maps / Google / Yelp / Tripadvisor search links. Not pinned and kind not note/flight: "Not on the map yet. Pick the place to pin it." + place search -> PATCH `location`.
Trip part: Day picker, time, note (saved on blur), status buttons (Keep, Mark booked, Needs booking / Doesn't need booking, Mark cancelled), Remove/Dismiss. Status line: `Booked|Idea|Cancelled|To book|Planned · 7:00 PM · <confirmation>`.

# Lodestar API contract: search, Stays and Plan (AI)

The iOS client codes against this document. It was written from the route handlers, zod schemas and components on `main` at `c566e67`. When this file and the code disagree, the code wins. Report the mismatch; don't guess.

Covered: flight search, the date calendar, airport and airline lookup, logos, hacks, the seller check (booking details), Stays (search, prices, flex), and Plan / AI (status, sign-in, sign-out, the canvas stream). Accounts, preferences, Trips, journeys and connectors have their own contracts.

---

## 0. Conventions that apply to every endpoint

### Base URL and transport
- Default base URL is `https://lodestar.xanom.co`, and it is configurable. Every path below is relative to it.
- JSON bodies use `Content-Type: application/json`. Send no `Origin` header. `lib/api.ts` `sameOrigin()` passes when `Origin` is absent, and the routes in this document don't check it anyway.
- Cookies: use one `URLSession` whose configuration shares `HTTPCookieStorage.shared` (or one persistent store), so the account session cookie, the AI device cookie and the AI PKCE cookie all flow automatically. Some of these cookies are scoped to `path=/api/ai` and are `HttpOnly` and `Secure`. `HTTPCookieStorage` handles that as long as every request goes through the same session.
- Request bodies are capped at **32,000 bytes** (`readJson`). A larger body is rejected (see Errors).

### Envelope
Every JSON route except the canvas stream and the logo images answers with:

```jsonc
{ "ok": true,  "data": <T> }
{ "ok": false, "error": "<user-facing sentence>" }
```

- On failure, show `error` as written. Every message is plain English and safe to display.
- When the body isn't JSON or lacks `ok`, show "Request failed (HTTP <status>)." (the web client does the same).
- When the request can't reach the server, the web shows "Can't reach Lodestar. Check your connection."
- Swift: decode `ok` first, then `data` as `T` or `error` as `String`.

### Error status mapping (`fromError`)
| Cause | HTTP | `error` text |
|---|---|---|
| zod validation failed | 400 | message of the **first** issue (for example "Use a three-letter airport code.", "Return is before departure.") |
| Body not JSON | 400 | "Request body is not JSON." |
| Body over 32 KB | **400** (a `FaresError` 413 becomes 400 because only statuses ≥ 500 pass through) | "Request is too large." |
| Fares service 4xx (incl. 422) | 400 | the service's `detail` string, or "Some search details are not valid." |
| Fares service unreachable / timed out | 503 | "The fares service is not reachable. Is it running?" / "The fare search took too long. Try again." (hotel routes say "hotel search") |
| Google page unreadable | 502 | "Google Flights returned data we could not read." / "Google Hotels returned data we could not read." |
| Fares service 5xx | same 5xx | its `detail` or "The fare search failed." / "The hotel search failed." |
| Anything unexpected | 500 | "The `<what>` failed. Try again." (`<what>` is given per endpoint) |
| Rate limited | 429 | "Too many requests. Wait a minute and try again." |

### Rate limits
The routes in this document use the **in-memory fixed-window limiter** (`rateLimited` in `lib/api.ts`). Each limit is per client IP, per route name, over a 60-second window, and resets when the window ends. It is per server instance, so treat it as approximate. Users behind carrier NAT share an IP. On 429, show the message and don't retry automatically.

### Timeouts
Several routes wait on Google. Set `timeoutIntervalForRequest` to at least the route's `maxDuration` plus a margin:
- `/api/search`, `/api/calendar`, `/api/sellers`, `/api/stays/*`: server `maxDuration` 60 s → client timeout **70 s**.
- `/api/ai/canvas`: `maxDuration` 300 s → client timeout **310 s**. While the stream runs, the gap between events can reach about 60 s.

### Value formats (apply everywhere)
- **Dates** are `"YYYY-MM-DD"` strings. Keep them as `String` (or a custom `LocalDate` type) and don't decode them as `Date`. The server compares them as strings.
- **Flight times** (`Leg.depart`, `Leg.arrive`) are naive local ISO datetimes **without a UTC offset**, for example `"2026-11-26T08:15:00"`. Each one is the local time at its airport. Python's `isoformat()` can append microseconds (`"…:00.123000"`), but in practice it doesn't. Keep them as `String`. To display them, read `HH:mm` from characters 11–16 and the date from characters 0–10, and never convert time zones. The web shows `h:mm am/pm` and `Thu, Nov 26`, formatted in the `UTC` time zone so nothing shifts.
- **Money** is a `Double` in USD (a US point of sale). `currency` is always `"USD"` in practice. The web rounds to whole dollars and shows `$1,234`; null shows as `—`.
- **Durations** are integer minutes. The web shows `5h 20m`, `5h` or `45m`.
- **Relative URLs**: `logo` fields are paths such as `/api/logo/airline/UA`. Resolve them against the base URL.
- Swift reserved words: the JSON key `return` needs `CodingKeys` (for example `case returnDate = "return"`).

---

## 1. Shared types

### 1.1 `Itinerary` (from `lib/types.ts`, produced by the fares service)

```ts
Itinerary {
  id: string                // 12 hex chars, a hash of tfs (or of the flights); unique per fare, cabin and passenger count
  price: number             // total for all travellers, USD, includes requested bag fees when Google adds them
  currency: string          // "USD"
  slices: Slice[]           // length 1 (one-way) or 2 (round trip: [outbound, return]); never empty
  booking_url: string       // absolute https URL to this exact itinerary on Google Flights
  tfs: string | null        // Google's itinerary token; null means the seller check is impossible
}

Slice {
  minutes: number           // int, door-to-door duration of this direction
  stops: number             // int
  legs: Leg[]               // ≥ 1
  layovers: Layover[]       // length legs.length - 1 (layovers[i] sits between legs[i] and legs[i+1])
  self_transfer: boolean
  co2_kg: number | null     // int kg
  co2_delta_pct: number | null  // int, + means above typical
}

Leg {
  from: string              // IATA
  from_name: string | null  // airport name
  to: string
  to_name: string | null
  depart: string            // naive local ISO datetime, see 0
  arrive: string
  minutes: number
  airline: { code: string, name: string }      // marketing carrier; code is 2 chars
  operating: { code: string, name: string } | null
  flight_number: string     // digits only, e.g. "1234"; show as "<airline.code> <flight_number>"
  aircraft: string | null
  legroom: string | null    // e.g. "31 in"
  overnight: boolean
  amenities: { [key: string]: unknown } | null
}

Layover {
  airport: string | null    // IATA
  city: string | null
  minutes: number
  overnight: boolean
  change_of_airport: boolean
}
```

`Leg.amenities` keys (all optional and tri-state, `null` or absent meaning unknown): `wifi: bool`, `power: bool`, `usb_power: bool`, `in_seat_video: bool`, `on_demand_video: bool`, `legroom_rating: int`, `wifi_tier: string`, `power_type: string`, `video_type: string`, `seat_quality: string`, `legroom_inches: number`. Decode it leniently, as a struct with optional fields, and ignore unknown keys. The web uses only `wifi` ("Wi-Fi") and `power || usb_power` ("Power").

**Airline display names**: before you show `airline.name`, apply the `NAME_OVERRIDES` table from `lib/airlines.ts`. fli's names are stale (for example AZ is listed as Alitalia).
`AZ ITA Airways, AA American, UA United, DL Delta, WN Southwest, B6 JetBlue, AS Alaska, NK Spirit, F9 Frontier, HA Hawaiian, G4 Allegiant, SY Sun Country, MX Breeze, XP Avelo, AC Air Canada, WS WestJet, BA British Airways, VS Virgin Atlantic, LH Lufthansa, AF Air France, KL KLM`.

### 1.2 `Hack` (from `lib/hacks.ts`)

```ts
Hack {
  kind: "nearby" | "flex" | "split" | "nonstop" | "ulcc" | "cabin" | "position" | "length" | "group" | "throwaway" | "timing" | "stopover"
  title: string             // ready-to-show sentence
  detail: string            // ready-to-show sentence
  saving: number            // int dollars saved vs baseline; NEGATIVE = costs more (nonstop, cabin); 0 = informational (ulcc, stopover)
  price: number             // the fare of the hacked option
  itineraryIds: string[]    // ids in SearchResult.itineraries, or for "split" [outId, backId] in oneWays.out / oneWays.back; [] for "flex"
  apply?: {                 // present when re-running a search reproduces the hack; ONLY these keys ever appear:
    from?: string[]         //   position
    depart?: string         //   flex
    return?: string | null  //   flex, length, throwaway (string sets round trip)
    cabin?: "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST"   // cabin
    adults?: number         //   group (always 1)
  }
  caution?: string
}
```

Decode `kind` as a Swift enum that keeps an `unknown(String)` fallback, so a new kind on the server doesn't break decoding.

### 1.3 `DayPrice`
```ts
DayPrice { depart: string /*date*/, return: string | null /*date*/, price: number }
```

### 1.4 Enums
- `Cabin`: `"ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST"`
- `MaxStops`: `"ANY" | "0" | "1" | "2"` (strings)
- `Alliance`: `"STAR_ALLIANCE" | "ONEWORLD" | "SKYTEAM"` (labels: "Star Alliance", "oneworld", "SkyTeam")
- `SellerTier`: `"airline" | "trusted" | "unvetted"`. Flight labels: "Airline direct", "Trusted agency", "Not vetted". Stays labels: "Hotel direct", "Trusted agency", "Not vetted". Status dot: green for airline and trusted, yellow for unvetted.

---

## 2. Flight search

### 2.1 `POST /api/search`
Live fares and the hacks computed from them. **Auth:** none. A signed-in user's preferences are **not** applied on the server; the client sends them in the body. **Rate limit:** 20/min/IP (`search`). **Timeout:** 70 s. Error label: "search".

**Request body: `SearchQuery`.** Every field except `from`, `to` and `depart` has a default:

| Field | Type | Rule / default |
|---|---|---|
| `from` | `[String]` | 1–6 items, each 3 letters (trimmed, uppercased). An IATA airport **or** a metro code (`NYC LON PAR TYO CHI WAS BAY MIL ROM SEL OSA STO YTO SAO BUE MOW`; `LAX` means the airport only). Metros expand on the server, and the total is capped at 6 airports. |
| `to` | `[String]` | same |
| `depart` | `String` date | must be ≥ yesterday (UTC) |
| `return` | `String?` date | default `null` (one-way); must be ≥ `depart` |
| `cabin` | Cabin | `"ECONOMY"` |
| `stops` | MaxStops | `"ANY"` |
| `adults` | Int | 1–9, default 1 |
| `children` | Int | 0–8, default 0; `adults + children ≤ 9` |
| `bags` | Int | 0–2 checked bags, default 0 |
| `nearby` | Bool | `true`: also search up to 3 nearby airports on each side |
| `flexible` | Bool | `true`: only tells the client to fetch `/api/calendar` (search itself never returns calendar days) |
| `split` | Bool | `true`: for round trips also price two one-ways |
| `alliances` | `[Alliance]` | ≤ 3, default `[]` |
| `avoidAirlines` | `[String]` | 2-char codes, ≤ 20 |
| `preferAirlines` | `[String]` | 2-char codes, ≤ 10 (ranking bonus only) |
| `noBasicEconomy` | Bool | `false` |
| `avoidRedEyes` | Bool | `false` |
| `avoidSelfTransfer` | Bool | `true` |

The web builds this from its form plus saved preferences: `alliances ← prefs.alliances`, `avoidAirlines ← prefs.avoidedAirlines`, `preferAirlines ← prefs.preferredAirlines`, and the three booleans copied as they are. Note the names differ (`avoidedAirlines` and `preferredAirlines` in preferences).

**Response `data`: `SearchResult`**
```ts
SearchResult {
  airports: {
    from: string[]          // requested origins after metro expansion
    to: string[]
    nearbyFrom: string[]    // extra airports added by `nearby`
    nearbyTo: string[]
  }
  baseline: number | null   // cheapest fare between exactly the requested airports
  itineraries: Itinerary[]  // already in "best" order (see ranking); may be []
  labels: { best?: string, cheapest?: string, fastest?: string }   // itinerary ids; all absent when no results
  hacks: Hack[]             // sorted by saving desc
  calendar: DayPrice[]      // always [] from this route — fetch /api/calendar
  oneWays: { out: Itinerary[], back: Itinerary[] } | null   // only for round trips with split on and both one-way searches succeeding
  warnings: string[]        // e.g. "One-way return: <message>", "Only red-eye flights were found, so they are shown anyway"
}
```

**Server behaviour worth knowing:**
- Validation failures (400): "We don't know the airport XYZ.", "From and to are the same place.", "That departure date has passed.", plus the zod messages ("Use a three-letter airport code.", "Use a two-character airline code.", "Use YYYY-MM-DD.", "Return is before departure.", "At most 9 travellers.").
- Avoidances never empty the results. When everything would be filtered out, everything stays and a warning is added.
- Ranking ("best"): score = price + $25 for each hour over the fastest + $35 per stop + $120 for any self-transfer + $30 per overnight layover, minus $40 when every leg is on a `preferAirlines` carrier. Lower is better. `fastest` is the shortest total minutes (ties go to the lower price), and `cheapest` is the lowest price.
- Extra searches for hacks are capped at 10 s, and a hack whose search times out quietly doesn't appear. A hack appears only when it saves at least $15 (the thresholds differ per kind; the server already applied them).

**What the web shows (match it):**
1. Before the first result: 4 skeleton cards. While re-searching, the old results are dimmed and not tappable.
2. `warnings` (if any) as a small grey line: "Some extra checks didn't finish: " + warnings joined by "; ".
3. **Hack cards** (`hacks` plus a client-side `flex` hack, see 2.2), each showing its icon, `title`, "−$N" when `saving > 0`, `detail`, `caution` in grey, and an action link:

   | kind | icon (SF Symbol suggestion) | action label | action |
   |---|---|---|---|
   | nearby | mappin | Show flight | scroll to and highlight `itineraryIds[0]`, starting its seller check |
   | flex | calendar | Search these dates | re-search with `apply` |
   | split | arrow.triangle.branch | Show both tickets | open the "Two one-way tickets · $X total" panel with `oneWays.out[id0]` and `oneWays.back[id1]`, and show `caution` |
   | nonstop | airplane | Show flight | focus |
   | ulcc | exclamationmark.triangle (yellow) | Show flight | focus |
   | cabin | chair | Search that cabin | re-search with `apply` |
   | position | car | Search from there | re-search with `apply` |
   | length | calendar (range) | Search these dates | re-search with `apply` |
   | group | person.2 | Search one seat | re-search with `apply` |
   | throwaway | repeat | Search the round trip | re-search with `apply` |
   | timing | moon | Show flight | focus |
   | stopover | bed.double | Show flight | focus |

   Applying a hack: take the last searched form and override `from`, `depart`, `cabin` and `adults` when present. When `return` is present, set it, and switch to a round trip when it isn't null.
4. **Date strip** ("Nearby dates", "Lowest fare per departure day[, same trip length]") from `/api/calendar`, shown only with ≥ 2 days. Each bar shows its price, with the minimum in blue and the selected day in ink. Tapping a day re-searches with that `depart` (and `return` from the day, or the current return for a round trip). While it loads: "Checking prices three days either side…".
5. **Results list**:
   - Sort tabs Best (server order) / Cheapest (by display price) / Fastest (total minutes, then display price).
   - Toggles "Trusted sellers only" (default is the user's `trustedOnly` preference, true when signed out) and "Nonstop" (all slices `stops == 0`).
   - Airline chips: up to 10 carriers, ordered by the cheapest itinerary each appears on, each with its logo, name and "$min". Selecting chips keeps itineraries whose every leg is on a selected carrier.
   - Count "N flights" ("1 flight").
   - "Trusted sellers only" also hides itineraries whose seller check finished with `lowestTrusted == null`.
   - Pages of **12**, then a "Show N more" button.
   - Empty after filters: "No flights match these filters." Empty search: "No flights found for these dates. Try nearby dates or other airports."
6. **Badges** per card: "Best" (blue), "Cheapest", "Fastest" (from `labels`), "Nearby airport" (any slice starts or ends at a `nearbyFrom`/`nearbyTo` code; those codes also show in blue), and "Self-transfer" (yellow dot).
7. **Itinerary card** (collapsed): per slice, logos (up to 2 airlines), "8:15am – 4:40pm" with "+1" when it lands a day later, "Out · " / "Back · " on round trips, the date and airline names, the duration, `FROM–TO` in mono, "Nonstop" or "N stops", and the via airports in mono. Right side: display price, "round trip"/"one way", and the seller line (see 2.3).
   - **Display price** = `lowestTrusted` when "trusted only" is on and the check is done and non-null; otherwise `price`.
8. **Expanded card**: per slice "Outbound"/"Return"/"Flight" · date · duration · "N kg CO₂ (+X% vs typical)". Per leg: time, airport name and (code), duration · airline · `AA 1234` mono · "operated by X" when `operating.code != airline.code` · aircraft · "31 in legroom", Wi-Fi/Power. Layover rows read "2h 5m layover in <city or airport>" plus " · overnight", " · change airports" and " · tight connection" (< 60 min). A layover gets a yellow dot when it is < 60 min, overnight or a change of airport. Self-transfer note: "Self-transfer: separate tickets. You collect and re-check bags, and a missed connection is on you." Opening a card starts its seller check when none exists.
9. **Booking**: Lodestar never sells tickets. "Book" opens `booking_url` (or the seller check's `bookingUrl`) in Safari. That is Google Flights, where the user continues to the seller.

### 2.2 `POST /api/calendar`
Lowest fare per departure day, same trip length. **Auth:** none. **Rate limit:** 30/min/IP (`calendar`). **Timeout:** 70 s; Google often takes 20 s or more. Error label: "date check".

**Body:** the same `SearchQuery` as 2.1, plus an optional
```ts
window?: { start: string /*date*/, end: string /*date*/ }   // e.g. the date picker's visible months
```
Without `window` the range is depart ±3 days. Days start no earlier than tomorrow (UTC) and cover at most **62** days. Only `from`, `to`, `cabin`, `stops`, `adults`, `children`, `alliances`, `avoidAirlines` and the return/depart gap affect the result.

**Response `data`:** `DayPrice[]` (a bare array, not an object). For round trips `return` is that day's return date (same trip length); for one-ways it is `null`. It returns `[]` for a same-day round trip or an empty range.

**Client-side flex hack** (the web computes it after the calendar arrives, so port it; `MIN_SAVING = 15`):
```
chosen = days.first(where depart == searched.depart)?.price ?? (bags > 0 ? nil : result.baseline)
if days empty or chosen nil → none
best = day with min price
saving = chosen - best.price;  if best.depart == searched.depart or saving < 15 → none
shift = daysBetween(searched.depart, best.depart)
newReturn = roundTrip ? (best.return ?? searched.return + shift days) : nil
Hack(kind: flex,
     title: "\(shift<0 ? "Leave" : "Go") \(|shift|) day\(|shift|==1 ? "" : "s") \(shift<0 ? "earlier" : "later")",
     detail: "\(when) is $\(round(saving)) less than your dates.",   // when = "Thu, Nov 26 – Mon, Nov 30" or "Thu, Nov 26"
     saving: round(saving), price: best.price, itineraryIds: [], apply: {depart: best.depart, return: newReturn})
```
Merge it into `hacks` and re-sort by `saving` descending. The web fetches the calendar only when `flexible` is true, after the search results arrive, and drops a response that belongs to an older search.

### 2.3 `POST /api/sellers`: seller check / booking details
Who sells this exact itinerary, at which fares, and which sellers are trusted. **Auth:** none. **Rate limit:** 40/min/IP (`sellers`). **Timeout:** 70 s (the server reads Google's booking page in a headless browser, which takes up to 45 s). Error label: "seller check".

**Body:**
| Field | Type | Rule |
|---|---|---|
| `tfs` | String | `Itinerary.tfs`, regex `^[A-Za-z0-9_-]{16,2048}$`, else 400 "Invalid itinerary." Skip the check when `tfs` is null. |
| `airlines` | `[{code: String ≤3, name: String ≤80}]` | ≤ 12, default `[]`. Send the unique marketing airlines across all legs, with display names (overrides applied). The server uses them to match an airline seller to its logo. |
| `price` | Double? | > 0, ≤ 1,000,000. Send `Itinerary.price`; fares under 80% of it are dropped as other-cabin fares. |

**Response `data`: `Verified`**
```ts
Verified {
  sellers: VerifiedSeller[]       // sorted: lowest asc, then tier airline < trusted < unvetted
  insight: {
    level: "low" | "typical" | "high" | null
    typical_low: number | null
    typical_high: number | null
    unlikely_to_drop_below: number | null
    cheaper_than_usual_by: number | null
    summary: string | null
  }
  bookingUrl: string              // absolute Google Flights URL for this itinerary
  lowestAny: number | null
  lowestTrusted: number | null    // cheapest airline-or-trusted seller
  trustedSeller: string | null    // that seller's name
  unvettedGap: number             // ≥ 0: how much cheaper the cheapest unvetted seller is than lowestTrusted
}

VerifiedSeller {
  name: string
  is_airline: boolean
  lowest: number
  fares: Fare[]                   // ≥ 1 in practice
  tier: "airline" | "trusted" | "unvetted"
  logo: string                    // relative path: /api/logo/airline/XX or /api/logo/site/<domain>?name=… or /api/logo/site/_?name=…
}

Fare {
  name: string | null             // fare tier, e.g. "Basic Economy"; null → show "Standard"
  price: number
  features: string[]
  policy: {
    carry_on: boolean | null
    checked_bag_fee: number | null       // 0 = included
    checked_bag_included: boolean | null
    changes: "free" | "fee" | "none" | null
    refunds: "full" | "partial" | "none" | null
    seat_selection: "free" | "fee" | "none" | null
  }
}
```
Decode the `policy` strings with an unknown fallback. They are typed as plain `string` on the wire.

**When the web runs checks:** it checks the **first 4** results of every search automatically, at most **2 at a time** in a FIFO queue. Cards opened or focused by the user queue their own checks. A new search drops queued checks that haven't started. "Try again" re-queues a failed check.

**Seller line on the collapsed card:** before the check, "Sellers not checked". While loading, a spinner and "Checking sellers". On failure, "Couldn't check sellers". With `lowestTrusted == null`, a yellow dot and "Only unvetted agencies". Otherwise a green dot and "Airline direct" (when an airline seller's `lowest == lowestTrusted`) or `trustedSeller`. When "trusted only" is on and `round(lowestTrusted) != round(price)`, the dot turns yellow, and when `lowestTrusted > price` it adds " · $<price> elsewhere".

**Sellers panel (expanded card, "Who sells this"):**
- While loading: 3 skeleton rows and "Reading the live booking page for this exact itinerary…". On error: the error text, a "Try again" button and an "Open on Google Flights" link (`booking_url`).
- **Insight box**, shown when `level` or `summary` is set. Dot: green for low, red for high, yellow otherwise. Text: "Price is {level}[, ${cheaper_than_usual_by} under usual]. " + "Similar trips usually cost $low–$high. " (when both are set) + "Google expects it won't drop below $X, so waiting is unlikely to help." (when set).
- **Rows**: logo, name, tier label with dot, "$lowest" (with "from" underneath when there are several fares or a named fare), and a "Book" button that opens `bookingUrl`. When a seller has several fares or a named fare, each fare is a tile with name or "Standard", price and policy chips:
  - "Carry-on" (on `carry_on`)
  - bag: fee 0 → "Checked bag included" ✓; fee N → "Checked bag $N" (neutral); `checked_bag_included == false` → "No checked bag" ✗; otherwise "Checked bag" (neutral)
  - changes: "free" → "Free changes" ✓; "fee" → "Changes for a fee" (neutral); "none" → "Changes" ✗; null → "Changes" (neutral)
  - refunds: "full" → "Refundable" ✓; "partial" → "Partly refundable" ✓; "none" → "Refunds" ✗; null → neutral "Refunds"
  - seats: "free" → "Seat choice" ✓; "fee" → "Seat choice for a fee" (neutral); "none" → "Seat choice" ✗
  - ✓ means ink with a check, ✗ means muted and struck through, neutral means grey with a dash.
- **Unvetted sellers** are hidden while "trusted only" is on. A link reads "Show N unvetted agenc(y|ies)", plus " (from $lowestAny, $unvettedGap less)" when `unvettedGap > 0`, and toggles to "Hide unvetted agencies". When nothing trusted is left: "No airline or trusted agency sells this itinerary. Only unvetted agencies list it."
- "I booked this" (marking a Trip booked) appears only inside a saved trip. It belongs to the Trips contract (`PUT /api/trips/:id/booking`).

### 2.4 `GET /api/airports?q=<text>`
Airport and metro suggestions. **Auth:** none. **Rate limit:** none. Cached `public, max-age=86400`.
- `q` is cut to 60 chars. An empty `q` returns `[]`.
- **Response `data`:** `AirportSuggestion[]` (≤ 8)
```ts
AirportSuggestion { code: string, label: string, detail: string, metro: boolean }
// airport: { code: "SFO", label: "San Francisco (SFO)", detail: "San Francisco International Airport · US", metro: false }
// metro:   { code: "NYC", label: "New York (all airports)", detail: "JFK · EWR · LGA", metro: true }
```
Metros come first. Matching ignores accents and case, and scores an exact code, then city, city prefix, code prefix and name substring, with larger airports weighted up.
- Web field behaviour: it debounces by **120 ms** and cancels the previous request. It shows only suggestions for the current text and drops stale ones. A field holds up to **4** codes as chips (the search accepts up to 6). Typing exactly 3 letters and pressing Return adds that code without a suggestion. Backspace on empty text removes the last chip.

### 2.5 `GET /api/airlines?q=<text>`
Airline suggestions (the preferences picker). **Auth:** none. **Rate limit:** none. Cached for a day.
- `q` is cut to 40 chars. An empty `q` returns `[]`.
- **Response `data`:** `[{ code: string /*2 chars*/, name: string /*display name*/ }]` (≤ 8). Ranking: exact code, then exact name, name prefix, word prefix and substring, with popular carriers boosted. In the picker, Return on exactly 2 characters adds that code.

### 2.6 Logos (images, not JSON)
Neither route uses the envelope, needs auth or has a rate limit. The response is always 200 with an image, never a broken one.
- `GET /api/logo/airline/{code}`: `code` is 2–3 of `[A-Z0-9]`, case-insensitive. Source order: Google's airline logo, then Kiwi's, then a drawn monogram.
- `GET /api/logo/site/{domain}?name=<seller name>`: a seller's favicon from Google's or DuckDuckGo's icon service (Lodestar never contacts the domain itself). Use `_` as the domain to always get a monogram for `name` (≤ 60 chars).
- Content types: `image/png | jpeg | gif | webp | x-icon | vnd.microsoft.icon` for real logos (`Cache-Control: public, max-age=604800, stale-while-revalidate=86400`), or **`image/svg+xml`** for the monogram fallback (`max-age=600`).
- **Native caveat:** `UIImage` can't decode the SVG monogram. When `Content-Type` is `image/svg+xml` (or decoding fails), draw the monogram natively: a rounded square (radius 12 at 64 pt, scaled), fill `#fcfdff` with black text in Geist semibold. The initials rule matches `lib/logos.ts initials()`: strip a trailing `.com/.net/.org/.co/.io`. If what remains is 2–3 chars of `[A-Z0-9]`, use it. Otherwise use the first letter of each of the first two words (split on space, `-`, `_` or `.`), or the first two letters of a single word, uppercased, or `?`. ICO responses decode through ImageIO.
- The web draws logos with a white background, `object-fit: contain`, 2 pt padding and an 8 pt radius. Sizes: 28 for one airline, 22 when there are two (overlapping), 20 per leg and 24 in the airline chips.

---

## 3. Stays

Prices are for **one room**. Hotel tiers reuse the flight table, with the hotel's own site as "Hotel direct" (`tier == "airline"`).

### Shared Stays query rules
| Field | Type | Rule |
|---|---|---|
| `checkin` | String date | ≥ today (UTC), else 400 "Pick a check-in date from today on." |
| `checkout` | String date | 1–30 nights after checkin, else 400 "A stay is 1 to 30 nights." |
| `adults` | Int | 1–8, default 2 |
| `city` | String (search/flex only) | trimmed, 2–80 chars, letters, digits, spaces and `, . ' ’ ( ) -`. Errors: "Enter a city." and "Use a place name, like Lisbon." |
| `key` | String (prices only) | `^[A-Za-z0-9_-]{10,200}$`, else "Invalid hotel." |

### 3.1 `POST /api/stays/search`
**Auth:** none. **Rate limit:** 20/min/IP, in the bucket `stays`, which it **shares with `/api/stays/flex`**. One search from the web therefore spends 2. **Timeout:** 70 s. Error label: "hotel search".

**Body:** `{ city, checkin, checkout, adults }`
**Response `data`:**
```ts
{ hotels: Hotel[], url: string /*Google Hotels results page*/ }

Hotel {
  key: string               // opaque id for /api/stays/prices
  name: string
  price: number             // Google's "from" price PER NIGHT, BEFORE taxes
  deal_pct: number | null   // int, "% under usual"
  rating: number | null     // 0–5, one decimal
  reviews: number | null    // int
  stars: number | null      // int hotel class
  amenities: string[]
  image: string | null      // absolute URL to Google's thumbnail
}
```

### 3.2 `POST /api/stays/prices`
Every seller's price for one hotel, with taxes and fees. **Auth:** none. **Rate limit:** 40/min/IP (`stayPrices`). **Timeout:** 70 s. Error label: "hotel prices".

**Body:** `{ key, checkin, checkout, adults }` (use the same dates and guests as the search the hotel came from).
**Response `data`:**
```ts
{ offers: VerifiedOffer[], url: string /*Google Hotels page for this hotel*/ }

VerifiedOffer {
  seller: string
  official: boolean               // the hotel's own site
  nightly_base: number            // per night before taxes
  nightly: number                 // per night with taxes and fees
  total: number                   // whole stay with taxes and fees
  free_cancel_until: string | null   // date
  url: string | null              // absolute booking link through Google Hotels; null → no Book button
  tier: "airline" | "trusted" | "unvetted"   // "airline" here means Hotel direct
  logo: string                    // relative /api/logo/site/... path
}
```
Already sorted by `total` ascending, then tier (direct first). May be `[]`.

### 3.3 `POST /api/stays/flex`
Per hotel, what arriving a night earlier or later saves (same number of nights). **Auth:** none. **Rate limit:** shares `stays` (20/min) with search. **Timeout:** 70 s. Error label: "date check".

**Body:** `{ city, checkin, checkout, adults }` (the same search).
**Response `data`:**
```ts
{ savings: { [hotelKey: string]: FlexSaving } }   // object keyed by Hotel.key; may be {}
FlexSaving { shift: "earlier" | "later", checkin: string, checkout: string, saving: number /*int dollars, whole stay*/ }
```
A shifted run whose check-in would fall before today is skipped, and one that fails is ignored. A saving is listed only when it is ≥ $20 **and** ≥ 8% of the stay. It's an estimate built from before-tax "from" prices. Decode it as `[String: FlexSaving]`.

### What the Stays screen shows (match it)
- Hero before the first search: "Hotels too." / "Same sellers you can trust." (Geist Serif, second line dimmer). Body: "Live prices from Google Hotels, checked seller by seller with taxes included. Every search also tries arriving a night earlier or later, and shows what a refundable rate costs."
- Form: Where ("City or neighborhood", ≤ 80), Check in (min today), Check out (min checkin + 1), Guests (1–8 adults). Defaults: check-in today + 21 days, 3 nights, 2 adults. Moving check-in keeps the length of stay. Search is enabled when the city has ≥ 2 chars, check-in ≥ today and the stay is 1–30 nights; otherwise it shows "Stays are up to 30 nights."
- After a search, the client fires `/api/stays/flex` in the background with the same body. A newer search cancels pending price checks and flex.
- Header: "N stays in {city}" · "Thu, Nov 26 – Sun, Nov 29 · 3 nights · one room for 2 adults". On the right: "Checking a night earlier and later…", then either "N stays cost less a night earlier or later." or "Moving a night doesn't save much here.", or "Couldn't check nearby dates." on error.
- Note line: "Prices are Google's lowest per night before taxes. Open a stay for every seller's price with taxes and fees."
- **Hotel card**: thumbnail (an empty grey box when there's none or it fails), name, "★ 4.5 (1,234)", "4-star", and "N% under usual" (green text). It lists the first 4 amenities joined by " · ", then "from $price a night, before taxes". When a flex saving exists, a blue link reads "About $N less arriving a night earlier|later (Thu, Nov 25 – Sun, Nov 28). Search those dates", and tapping it re-runs the search with those dates.
- Opening a card fetches `/api/stays/prices` once, under "Who sells this stay, with taxes and fees". Loading shows 3 skeletons and "Reading every seller's price for these dates…". An error shows its message and "Try again".
- **Refundable note**, computed over the *shown* offers. `cheapest = shown[0]`, `flexible = first shown offer with free_cancel_until != null`.
  - None: "None of these rates can be cancelled for free."
  - The cheapest is flexible, or `flexible.total ≤ cheapest.total`: "The cheapest rate here can be cancelled for free until {date}."
  - Otherwise: "**Refundable for $extra more** ($extra/nights a night) with {seller}, free to cancel until {date}."
- **Offer row**: logo, seller, tier dot and label, and "Free cancellation until Thu, Nov 26". On the right: "$total" and "$nightly × N nights", plus a "Book" button when `url` is set.
- Unvetted offers are hidden while "trusted only" is on. A link reads "Show N unvetted agenc(y|ies)", plus " (from $hidden[0].total, $(shown[0].total − hidden[0].total) less)" when positive. With nothing trusted: "Only agencies we haven't vetted list this hotel for these dates." Footer link: "Open on Google Hotels" (`url` from the prices response). Under the list: "See more on Google Hotels" (`url` from the search).

---

## 4. Plan (AI)

The model runs on the **user's own** ChatGPT (provider id `codex`) or Grok (`grok`) subscription. Lodestar's server holds the tokens. The iOS app never sees or stores provider tokens: it holds only Lodestar cookies.

**Who owns a connection.** When the user is signed in to Lodestar, the connection is saved to the account (`ai_connections`). It works on every device and survives sign-out. When signed out, it belongs to an anonymous device id (cookie `ls_device`, path `/api/ai`, 1 year), and the sealed tokens live in cookies `codex_s_0…5` / `grok_s_0…5` (path `/api/ai`, 30 days). When the user signs in later, the next AI request moves the device connection into the account. Account sign-out (`/api/account/logout`) clears only the device cookies; connections saved to the account stay.

Provider display names: `codex` → "ChatGPT", `grok` → "Grok".

### 4.1 `GET /api/ai/status`
**Auth:** none (uses the account session when there is one, or the device id otherwise). **Rate limit:** none. Always 200. It may set the `ls_device` cookie.
**Response `data`:**
```ts
{
  connected: { codex: boolean, grok: boolean },
  models: { codex: Model[], grok: Model[] }    // Model { id: string, label: string }
}
// models.codex e.g. [{id:"gpt-6-astra",label:"GPT-6 Astra"},{id:"gpt-6.1-sol",...},{id:"gpt-6.1-terra",...},{id:"gpt-6-luna",label:"GPT-6 Luna"}]
// models.grok  e.g. [{id:"grok-4.7",label:"Grok 4.7"},{id:"grok-4.6",label:"Grok 4.6"}]
```
The model list is refreshed from a public catalog every 5 minutes, so don't hardcode it. The web treats a failed call as `connected: false` everywhere with empty models. **The default provider is `codex` when connected, otherwise `grok`, otherwise none.** Call this on launch, after sign-in or sign-out, and after connecting or disconnecting.

### 4.2 Sign-in: `POST /api/ai/{provider}/start` and `POST /api/ai/{provider}/complete`

#### `POST /api/ai/{provider}/start`
- `provider` ∈ `codex | grok`, else 404 "Unknown provider.". **Auth:** none. **Rate limit:** 10/min/IP (`ai-start`). Send any body (`{}`); the route doesn't read it.
- Effect: it generates PKCE (verifier, S256 challenge, state) and stores `{verifier, state}` **sealed in a cookie** `{provider}_pkce` (HttpOnly, Secure, path `/api/ai`, **10 minutes**). It also sets `ls_device` if missing.
- **Response `data`:** `{ authorizeUrl: string }`, the provider's OAuth authorize URL:
  - codex: `https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+profile+email+offline_access&code_challenge=…&code_challenge_method=S256&state=…&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=codex_cli_rs`
  - grok: `https://auth.x.ai/oauth2/authorize?…&client_id=b1a00492-073a-47ea-816f-4c329264a828&redirect_uri=http%3A%2F%2F127.0.0.1%3A56121%2Fcallback&scope=openid+profile+email+offline_access+grok-cli%3Aaccess+api%3Aaccess&…`
- Each call replaces the pending attempt, so only the newest `state` will complete.

#### `POST /api/ai/{provider}/complete`
- **Auth:** none. It must carry the cookies set by `/start`, so use the **same cookie store**. **Rate limit:** 10/min/IP (`ai-complete`).
- **Body:** `{ "callback": String }`. It is trimmed and cut to 4,000 chars. It may be:
  - the full redirect URL `http://localhost:1455/auth/callback?code=…&state=…` (codex **requires** the `state` to match),
  - a query string `?code=…&state=…` or `code=…&state=…`,
  - or, for Grok only, the **bare code** the Grok page displays (no state; it binds to the pending attempt).
- **Response `data`:** `{ connected: "codex" | "grok" }`. On success the pending PKCE cookie is cleared.
- **Errors** (exact text):
  - 404 "Unknown provider."
  - 400 "Paste the link or code first." (empty callback)
  - 400 "Couldn't find a sign-in code in what you pasted."
  - 400 "This sign-in expired. Click Connect again." (no PKCE cookie: older than 10 minutes, or a different cookie store). On iOS, say "Tap Connect again".
  - 400 "That link is from a different sign-in attempt. Click Connect again." (state mismatch)
  - 502 "Sign-in failed. The code may have expired. Click Connect again." (token exchange failed)

#### How a native app starts and finishes the sign-in
The redirect URIs are **fixed loopback addresses** that belong to the Codex CLI and Grok CLI OAuth clients (`http://localhost:1455/auth/callback`, `http://127.0.0.1:56121/callback`). Lodestar doesn't own those clients, so it can't register a custom scheme or universal link with OpenAI or xAI. Changing the backend wouldn't help either. Because of that, `ASWebAuthenticationSession` **can't finish this flow by itself**. It completes only on a callback URL with a custom scheme (or, from iOS 17.4, an `https` callback on an associated domain the app owns), and the provider never redirects to either. None of this needs a backend change, because the PKCE secret lives in a Lodestar cookie in the app's own cookie store. The browser that does the OAuth only needs to hand the `code` (and `state`) back to the app.

The recommended flow, which mirrors what the Codex CLI does on desktop:
1. `POST /api/ai/{provider}/start` and read `authorizeUrl`.
2. Start a **loopback HTTP listener** in the app with `Network.framework`'s `NWListener`: TCP, `requiredInterfaceType = .loopback`, port **1455** for codex and **56121** for grok. `localhost` may resolve to `::1` as well as `127.0.0.1`, so accept on both. If the port is busy, skip to the fallback in step 5.
3. Present `ASWebAuthenticationSession(url: authorizeUrl, callback: .customScheme("lodestar"))` with `prefersEphemeralWebBrowserSession = false`, so an existing ChatGPT or X login in Safari is reused. The custom scheme never fires; the session exists only to show a secure browser sheet.
4. When the provider redirects, the sheet's browser sends `GET /auth/callback?code=…&state=…` (codex) or `GET /callback?code=…` (grok) to the listener. Then:
   - Reply with a tiny `200 text/html` page ("Connected. You can return to Lodestar.") and close the connection.
   - Rebuild the full URL (`http://localhost:1455` + request target) and call `session.cancel()`. Ignore the resulting `ASWebAuthenticationSessionError.canceledLogin`.
   - Stop the listener and `POST /complete { callback: <that URL> }`.
   - If the query has `error=…` instead of `code`, show "Sign-in was cancelled or refused. Try again." and don't call `/complete`.
5. **Fallback (always offer it)**, matching the web's two-step dialog. A text field takes the pasted address or code. **ChatGPT:** "You'll land on a page that doesn't load (a localhost address). That's expected: copy the full address from the address bar and paste it below." The `ASWebAuthenticationSession` sheet doesn't let users copy the address, so this fallback opens `authorizeUrl` in Safari (`UIApplication.shared.open`), where users can copy it. **Grok:** "Sign in with your X / Grok account. Grok then shows a code. Copy it and paste it below." Placeholders: `http://localhost:1455/auth/callback?code=…` or "Code from Grok", in mono. The Connect button stays disabled until something is pasted and shows "Connecting…" while busy.
6. On success, call `GET /api/ai/status` again.

Verify on a device before relying on the listener path: confirm that the `ASWebAuthenticationSession` browser can reach the app's loopback listener while the sheet is up. The app stays in the foreground, and loopback isn't subject to the local-network permission prompt, but nobody has tested this here. Also check that the browser isn't held on an x.ai code page instead of redirecting. If either check fails, the paste fallback (step 5) still works with no other changes.

Copy shown above the steps: "Lodestar's AI runs on your own ChatGPT or Grok subscription." Signed in, it continues "The sign-in token is encrypted and saved to your Lodestar account, so it works wherever you sign in. Disconnect to remove it." Signed out: "The sign-in token is encrypted and kept only in this browser's cookies. Sign in to Lodestar first to save it to your account." (On iOS, say "on this device".)

### 4.3 `POST /api/ai/{provider}/logout`
Disconnects the provider: from the account when signed in, and from the device cookies in any case. It also clears a pending PKCE. **Auth:** none. **Rate limit:** none. Body is ignored (`{}`).
**Response `data`:** `{ disconnected: "codex" | "grok" }`. 404 "Unknown provider.". The web ignores failures and then refreshes status.

### 4.4 `POST /api/ai/canvas`: the Plan stream
The model turns the request into up to 5 searches, the server runs them on live fares (2 at a time), and the model then picks and explains options. It can cite options only by ref, so every price shown is a real search result.

**Auth:** needs a connected provider for the current owner (account or device), else **401** "Connect your ChatGPT account first." / "Connect your Grok account first.". A Lodestar account is not required. **Rate limit:** 8/min/IP (`canvas`). **Timeout:** 310 s.

**Body:**
| Field | Type | Rule |
|---|---|---|
| `provider` | `"codex" \| "grok"` | else 400 "Unknown provider." |
| `model` | String? | ≤ 60 chars. A `Model.id` from status; omit it for "Default model". An unknown id falls back to the first catalog model. Planning always uses the catalog's fast tier, and the write-up uses this model. |
| `prompt` | String | trimmed, 3–1200 chars, else 400 "Tell Lodestar where you want to go." |
| `context` | `{String: Any}?` / null | The current flight search form, used as defaults. The web sends `{from, to, depart, return, cabin, stops, adults, bags, nearby, flexible, split}` (the `SearchQuery` subset; `return` is null for one-way) only when the form has both `from` and `to`, else `null`. |
| `history` | `[{prompt: String ≤1200, reply: String ≤600}]` | ≤ 4, default `[]`. Earlier turns, oldest first: the last 4 turns that produced a canvas, with `reply = "\(headline) \(summary)"` trimmed and cut to 600. |
| `defaults` | object? / null | Saved trip defaults: `{homeAirports: [IATA] ≤4, cabin: Cabin, stops: MaxStops, adults: 1–9, bags: 0–2}`; each field defaults when missing. The web sends the user's preferences (or app defaults: `[]`, ECONOMY, ANY, 1, 0). |
| `filters` | object? / null | Applied to every planned search, all fields optional: `{alliances: [Alliance] ≤3, avoidAirlines: [code] ≤20, preferAirlines: [code] ≤10, noBasicEconomy: Bool, avoidRedEyes: Bool, avoidSelfTransfer: Bool}`. The web maps them from preferences as in 2.1. |

Validation errors return `400 {ok:false,error}` (the first zod message, or "Invalid request.", which also covers bodies that aren't JSON or are too large).

**Response:** HTTP 200, `Content-Type: application/x-ndjson; charset=utf-8`, with one JSON object per line. This route does **not** use the envelope. On iOS, read it with `URLSession.bytes(for:)` and `.lines`, check `statusCode == 200` first, decode the error envelope otherwise, and skip lines that don't parse. Cancelling the task aborts the server work (planning stops spending the user's subscription), so cancel when the screen goes away or a new message is sent.

**Events,** discriminated by `type`. Order: `status`, `plan`, then `search` events, `status`, `canvas` (or `error`), and always `done` last.
```ts
{ type: "status", text: string }        // "Reading your request", "Comparing the options"; web appends "…" with a spinner
{ type: "plan", plan: Plan }
{ type: "search", index: number, state: "running" }
{ type: "search", index: number, state: "done", count: number, cheapest: number | null }
{ type: "search", index: number, state: "error", error: string }
{ type: "canvas", canvas: Canvas, options: { [ref: string]: { itinerary: Itinerary, search: number } }, hacks: CanvasHack[] }
{ type: "error", error: string }        // e.g. "None of the searches found flights. Try other dates or airports.", "Your AI connection expired. Reconnect it.", "Your subscription's rate limit was hit. Try again in a moment.", "The AI answer was not in the expected shape. Try again."
{ type: "done" }
```
Model a `search` event as one struct with an optional `count`, `cheapest` and `error`, and treat an unknown `type` as ignorable.

```ts
Plan {
  understanding: string              // ≤ 400, may be ""
  assumptions: string[]              // ≤ 6
  searches: PlannedSearch[]          // ≤ 5; may be [] (then the canvas carries a question)
  question: string | null            // ≤ 300
  needsOrigin: boolean               // true when only the origin is missing
}
PlannedSearch {
  label: string                      // ≤ 80
  why: string                        // ≤ 240, may be ""
  from: string[], to: string[]       // IATA, 1–6
  depart: string, return: string | null
  cabin: Cabin, stops: MaxStops
  adults: number, bags: number
  nearby: boolean, flexible: boolean
}
Canvas {
  headline: string                   // ≤ 140
  summary: string                    // ≤ 600, may be ""
  picks: Pick[]                      // ≤ 6; every pick.ref exists in `options`
  tips: string[]                     // ≤ 5
  followups: string[]                // ≤ 4, ≤ 100 chars each
}
Pick {
  ref: string                        // "S<search#>-<option#>", 1-based, uppercase, e.g. "S2-1"
  title: string                      // ≤ 80
  why: string                        // ≤ 400
  tradeoff: string | null            // ≤ 240
  tag: "best" | "cheapest" | "fastest" | "comfort" | "hack" | "alternative"
}
options[ref].search                  // 0-based index into plan.searches
CanvasHack = Hack & { search: string }   // search = that PlannedSearch.label; only saving > 0, top 4 by saving
```
When the plan has no searches, the canvas event is `{headline: plan.question ?? "Tell me a bit more about the trip.", summary: plan.understanding, picks: [], tips: [], followups: []}` with `options: {}` and `hacks: []`.

**What the Plan screen shows (match it):**
- Hero before the first message: "Say the trip." / "Get the shortlist." (Geist Serif). Body: "Your ChatGPT or Grok account plans several live searches at once (other airports, other days, other cabins), then lays the best options out with the reasons and the catches."
- Composer: placeholder "Describe the trip. Where, roughly when, and what matters to you." (after the first turn: "Reply, or change the trip."), max 1200 chars. Return sends; shift-Return adds a newline.
  - A provider switch appears only when both providers are connected.
  - Model picker: "Default model" plus the `models[provider]` labels.
  - "Uses your search form as a starting point" appears when `context` is set and no turn has started yet.
  - Primary button: "Plan trip" (first turn), then "Send", with a spinner while running. With no provider connected, the button reads "Connect ChatGPT or Grok" and opens Connect.
  - "New trip" clears the conversation and aborts the run.
- Example chips before the first turn (tapping one runs it when connected, else fills the box):
  - "Bay Area to New York for Thanksgiving week, back the Sunday after. Cheapest that isn't miserable."
  - "A long weekend in Mexico City from LA in early December, nonstop only."
  - "Business class Seattle to Tokyo in March for under $3,000 if possible."
  - "Chicago to London next spring, flexible by a few days, I'm bringing a checked bag."
- **Each turn**, top to bottom:
  1. "You asked" with the prompt.
  2. A searches box (only when `plan.searches` isn't empty): `understanding`, then one row per search with a state icon (empty circle waiting, spinner running, check done, red alert error), `label`, a mono line like "SFO/OAK→JFK Thu, Nov 26–Sun, Nov 30", `why` in grey, and on the right "from $cheapest", "none" or "failed". Below, "Assumed: " followed by the assumptions joined by " · ".
  3. The status line, while running.
  4. The error box (red), if any. A non-200 response or lost stream shows its error. A dropped connection shows "Lost the connection to the AI. Try again."
  5. The canvas: `headline` (Geist Serif hero size when there are picks, plain 22 pt when there are none), `summary`, the Save control, then each pick: a tag pill ("best" in blue, others neutral, capitalised), the title, "from {plan.searches[search].label}", `why` + " Tradeoff: {tradeoff}" (muted), then a full itinerary card (2.1 item 7 and seller checks from 2.3, without badges).
  6. A "Hacks the searches found" box with one line per hack: "−$saving {title} ({search}). {detail}".
  7. Tips, each prefixed with "— ".
  8. Follow-up chips on the latest turn once it finishes; tapping one sends it as the next message.
- **Missing origin:** when the latest finished turn has `plan.needsOrigin` and the user has no home airports, show an airport field: "Where you usually fly from. Saved to your preferences, so Plan won't ask again." and a button "Save and plan". Saving writes `homeAirports` through the preferences API (a separate contract), then re-runs the same prompt in place of that turn, with `defaults.homeAirports` set.
- **Save to Trips:** after a turn with picks, the web shows "Save trip and get alerts". When signed out it shows "Sign in to save this trip". Once saved it shows "Saved. We'll email you if the price drops. Set alerts". It posts `POST /api/trips` with `{snapshot: {prompt, plan, canvas, options, hacks, searches /*per-search states*/}, searches: plan.searches, filters, price /*min of done searches' cheapest > 0, else min option price*/}` and reads `{id}`. The Trips contract owns that endpoint; use its schema.

---

## 5. Endpoint summary

| # | Method + path | Auth | Rate limit (per IP) | Returns |
|---|---|---|---|---|
| 1 | `POST /api/search` | none | 20/min | `SearchResult` |
| 2 | `POST /api/calendar` | none | 30/min | `DayPrice[]` |
| 3 | `POST /api/sellers` | none | 40/min | `Verified` |
| 4 | `GET /api/airports?q=` | none | none | `AirportSuggestion[]` |
| 5 | `GET /api/airlines?q=` | none | none | `[{code,name}]` |
| 6 | `GET /api/logo/airline/{code}` | none | none | image (PNG etc. or SVG monogram) |
| 7 | `GET /api/logo/site/{domain}?name=` | none | none | image (PNG/ICO etc. or SVG monogram) |
| 8 | `POST /api/stays/search` | none | 20/min shared with 10 | `{hotels, url}` |
| 9 | `POST /api/stays/prices` | none | 40/min | `{offers, url}` |
| 10 | `POST /api/stays/flex` | none | 20/min shared with 8 | `{savings}` |
| 11 | `GET /api/ai/status` | optional (account or device) | none | `{connected, models}` |
| 12 | `POST /api/ai/{provider}/start` | optional | 10/min | `{authorizeUrl}` + PKCE cookie |
| 13 | `POST /api/ai/{provider}/complete` | needs `/start`'s cookie | 10/min | `{connected}` |
| 14 | `POST /api/ai/{provider}/logout` | optional | none | `{disconnected}` |
| 15 | `POST /api/ai/canvas` | connected AI provider | 8/min | NDJSON stream |

## 6. Native blockers and caveats (no backend changes were made)
1. **AI sign-in redirects to fixed loopback URIs** owned by the CLI OAuth clients. `ASWebAuthenticationSession` can't capture them by itself. Use the in-app loopback listener plus the paste fallback (4.2). The listener path needs testing on a device.
2. **Logo fallbacks are SVG** (`image/svg+xml`), which `UIImage` can't decode. Draw the monogram natively (2.6).
3. **The flex-dates hack is computed on the client** from `/api/calendar`, so port that logic (2.2).
4. Flight times carry **no time zone**. Treat them as wall-clock strings (0).
5. Rate limits are in memory and per IP, so treat them as approximate. Stays search and flex share one bucket.

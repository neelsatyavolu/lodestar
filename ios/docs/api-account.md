# Lodestar API contract: account, session, preferences, onboarding, design tokens

Source of truth: `lib/api.ts`, `lib/client.ts`, `lib/account/*`, `lib/server/auth.ts`, `lib/server/limits.ts`, `lib/preferences.ts`, `lib/types.ts`, `app/api/account/**`, `app/api/preferences/route.ts`, `components/{app,account-dialog,reset-form,preferences-dialog,tastes,onboarding,tour,ui,dialog,theme-toggle}.tsx`, `app/globals.css`, `~/DESIGN.md`. Everything below was read from that code (as of commit `c566e67`).

---

## 1. Transport rules (all endpoints)

### Base URL
Default `https://lodestar.xanom.co`. All paths below are relative to it.

### Envelope
Every JSON response body is one of:

```json
{ "ok": true,  "data": <T> }
{ "ok": false, "error": "<human-readable sentence>" }
```

- `error` strings are written for end users. Show them as-is.
- Failure responses carry `cache-control: no-store`.
- Unwrap rule (mirror `lib/client.ts`): if the HTTP status is not 2xx **or** `ok != true`, throw `ApiError(message: body.error ?? "Request failed (HTTP \(status)).", status)`. If the body is not JSON, same fallback message.
- Network failure (no response): show `"Can't reach Lodestar. Check your connection."` (status 0). Cancellation must stay a cancellation, not an error banner.

Swift shape:
```swift
struct Envelope<T: Decodable>: Decodable { let ok: Bool; let data: T?; let error: String? }
```

### Request headers
- `Content-Type: application/json` on every request (the web client sends it on GETs too; harmless).
- **Do not send `Origin`.** `handle()` refuses any non-GET whose `Origin` host differs from the request host with **403 `"Cross-site request refused."`**. No `Origin` header = allowed. URLSession does not add one by default.
- No CSRF token, no bearer token. Auth is the session cookie only.

### Body limits and parse errors (any endpoint that reads a body)
- Body over 32,000 bytes (by `Content-Length` or actual length) -> **413 `"Request is too large."`**
- Body that is not valid JSON (including an **empty body**) -> **400 `"Request body is not JSON."`**. So endpoints that take a body must always get at least `{}`.

### Unexpected server errors
Any uncaught error -> **500 `"The <what> failed. Try again."`**, where `<what>` per endpoint is given below (e.g. `"The sign-in failed. Try again."`).

### Zod validation errors not caught by a route
Mapped to **400** with the first zod issue's message (only `PUT /api/preferences` reaches this path; see section 4).

---

## 2. Session cookie (`lib/account/session.ts`, `lib/server/auth.ts`)

| Property | Value |
|---|---|
| Name | `ls_session` |
| Value | `<userId>.<expiresAtMs>.<sessionVersion>.<mac>`. `userId` is a lowercase UUID, `expiresAtMs` is Unix epoch milliseconds, `sessionVersion` is 1 to 9 digits, `mac` is base64url HMAC-SHA256. Opaque to the client: never parse, build or edit it. Max accepted length 200 chars. |
| Lifetime | 30 days (`SESSION_TTL_MS = 2_592_000_000`). Cookie `Max-Age=2592000`; the signed `expiresAt` inside the value is the same 30 days. **Not sliding**: it is only reissued on login, register, reset, and sign-out-everywhere. After 30 days the user must sign in again. |
| HttpOnly | yes |
| SameSite | `Lax` |
| Secure | yes in production (`NODE_ENV=production`), no in local dev (so `http://localhost:3000` works) |
| Path | `/` |
| Domain | not set (host-only cookie for the API host) |
| Cleared by | `POST /api/account/logout`, `DELETE /api/account` (cookie deleted with `path=/`) |

Validity on the server: signature valid, not expired, and `sessionVersion` equals the account's current `session_version`. A password reset or "sign out everywhere" increments the account's version, which kills every older cookie everywhere. A deleted account kills all cookies.

**Native handling**
- Use `URLSessionConfiguration.default` with `HTTPCookieStorage.shared` (or a dedicated persistent storage) and `httpShouldSetCookies = true`, `httpCookieAcceptPolicy = .always`. The cookie has a `Max-Age`, so it is persisted across launches automatically.
- "Signed in" is decided only by `GET /api/account` returning a non-null `user`. A cookie being present proves nothing (it may be revoked). Any 401 from an authenticated endpoint means: drop to signed-out state.
- On logout, also delete any `ls_session` cookie from storage locally after the call (in case the network call failed). The web client ignores logout failure and signs out locally anyway.
- Other cookies the server may set on the same jar: `ls_device` (anonymous device id, path `/api/ai`, 1 year) and AI token cookies `codex_s_0..5`, `grok_s_0..5`, `codex_pkce`, `grok_pkce` (path `/api/ai`). Those belong to the Plan/AI contract; just let the cookie jar keep them.

---

## 3. Account endpoints

Common types:

```ts
// Returned by register and login
AccountUser = { email: string }                      // normalized: trimmed, lowercased
// Returned by GET /api/account only
AccountProfile = { email: string, createdAt: number } // createdAt = Unix epoch MILLISECONDS (JSON number)
```

Input normalization (zod, `lib/account/input.ts`):
- `email`: string, trimmed, lowercased, must be a valid email, max 254 chars after trimming.
- new password (register, reset): string, length 8...200 (`MIN_PASSWORD_LENGTH = 8`). No other complexity rule. Not trimmed.
- login / delete password: string, length 1...200.
- Unknown extra fields are ignored.

### 3.1 `GET /api/account` — who is signed in

- Auth: optional. Signed out is a normal 200 answer.
- Request: no body, no query.
- Rate limit: none.
- Response `data`:
  ```ts
  // signed in
  { user: { email: string, createdAt: number }, preferences: Preferences }
  // signed out, invalid/expired/revoked cookie, or account deleted
  { user: null, preferences: null }
  ```
  `preferences` is always a complete `Preferences` object (section 4) when signed in: saved values, or full defaults if never saved, or per-field defaults for any stored field that no longer validates.
- Errors: 500 `"The account check failed. Try again."`
- Swift: `struct AccountState: Decodable { let user: AccountProfile?; let preferences: Preferences? }`.

### 3.2 `POST /api/account/register` — create account and sign in

- Auth: none.
- Request body:
  ```ts
  { email: string, password: string, preferences?: Preferences | any }
  ```
  `preferences` is optional and lenient: whatever the user set before signing up. It is read with `readPreferences` (field-by-field; any missing or invalid field silently becomes its default; never fails the request). Send the full current local `Preferences`.
- On success: account created, preferences saved, `Set-Cookie: ls_session=...` issued.
- Response `data`: `{ user: { email: string }, preferences: Preferences }` (the email is the normalized one; `preferences` is what was saved, after defaulting).
- Errors:
  | Status | `error` |
  |---|---|
  | 429 | `"Too many new accounts from here. Try again later."` (checked first, before validation) |
  | 400 | `"Request body is not JSON."` / `"Request is too large."` (413) |
  | 400 | `"Enter a valid email and a password of at least 8 characters."` |
  | 409 | `"An account with that email already exists. Sign in instead."` |
  | 403 | `"Cross-site request refused."` |
  | 500 | `"The sign-up failed. Try again."` |
- Rate limit: `register` = 5 per 60 min per client IP.
- After success the web app starts onboarding (section 6).

### 3.3 `POST /api/account/login` — sign in

- Auth: none.
- Request body: `{ email: string, password: string }`
- On success: `Set-Cookie: ls_session=...`.
- Response `data`: `{ user: { email: string }, preferences: Preferences }` (saved preferences, or defaults).
- Errors:
  | Status | `error` |
  |---|---|
  | 429 | `"Too many attempts. Try again in 15 minutes."` (checked first) |
  | 400 | `"Enter your email and password."` |
  | 401 | `"That email and password don't match an account."` (same for unknown email and wrong password) |
  | 403 / 413 / 400-JSON | as in section 1 |
  | 500 | `"The sign-in failed. Try again."` |
- Rate limit: `login` = 10 per 15 min per client IP.
- Note: unlike `GET /api/account`, login's `user` has no `createdAt`. Model it as optional, or call `GET /api/account` after login if the screen needs it.

### 3.4 `POST /api/account/logout` — sign out this device

- Auth: none required (works signed out too).
- Request body: ignored, not parsed. Send `{}`.
- Effect: deletes `ls_session`; also deletes this client's anonymous AI cookies (`codex_s_*`, `grok_s_*`, `*_pkce` on path `/api/ai`). An AI connection saved to the account stays with the account.
- Response `data`: `{}`
- Errors: 403 cross-site; 500 `"The sign-out failed. Try again."`
- Rate limit: none.
- Web behaviour: ignores any error, then locally: account = nil, leaves the Trips tab if it was open (Trips is signed-in only), resets preferences to `DEFAULT_PREFERENCES` without touching the current search form, refreshes AI status (`GET /api/ai/status`).

### 3.5 `POST /api/account` — sign out everywhere else

- Auth: **required**.
- Request body: `{ "action": "signout-everywhere" }` (exact literal; anything else -> 400).
- Effect: increments the account's session version (every existing cookie on every device dies), then issues a fresh `ls_session` to **this** client, so the caller stays signed in.
- Response `data`: `{}`
- Errors:
  | Status | `error` |
  |---|---|
  | 401 | `"Sign in first."` |
  | 400 | `"Unknown action."` |
  | 400 | `"Request body is not JSON."` (empty body) |
  | 403 / 413 | section 1 |
  | 500 | `"The sign-out failed. Try again."` |
- Rate limit: none.
- Web UI: **no button calls this today.** It exists in the API only. A native "Sign out of other devices" row is allowed by the API but is not a web feature; treat it as optional.

### 3.6 `DELETE /api/account` — delete account

- Auth: **required**.
- Request body: `{ password: string }` (1...200 chars).
- Effect: verifies password, deletes the user (every user-owned table references `users` with `ON DELETE CASCADE`: preferences, resets, AI connections, trips, journeys and the rest go with it), clears this client's AI cookies, deletes `ls_session`.
- Response `data`: `{}`
- Errors:
  | Status | `error` |
  |---|---|
  | 401 | `"Sign in first."` |
  | 400 | `"Enter your password to delete your account."` |
  | 401 | `"That password isn't right."` |
  | 400 / 403 / 413 | section 1 |
  | 500 | `"The account deletion failed. Try again."` |
- Rate limit: none.
- Web UI: **no screen calls this today.** Note for iOS: App Store guideline 5.1.1(v) requires in-app account deletion for apps that support account creation, so the native app needs a "Delete account" screen (password field + destructive confirm) against this endpoint. A 401 here is ambiguous (signed out vs wrong password); distinguish by the message, or check `GET /api/account` first.

### 3.7 `POST /api/account/forgot` — email a reset link

- Auth: none.
- Request body: `{ email: string }`
- Response `data` (success, and also deliberately whenever the address has no account, the per-address limit is hit, or the daily send budget is used up):
  ```ts
  { message: "If an account exists for that address, a reset link is on its way." }
  ```
  Show `message` verbatim as a neutral notice (not an error, not a success check). Never reveal whether the account exists.
- Errors:
  | Status | `error` |
  |---|---|
  | 429 | `"Too many attempts. Try again in 15 minutes."` (per-IP limit, checked first) |
  | 400 | `"Enter a valid email."` |
  | 502 | `"The reset email couldn't be sent. Try again later."` |
  | 403 / 413 / 400-JSON | section 1 |
  | 500 | `"The reset request failed. Try again."` |
- Rate limits: `forgot` = 5 per 15 min per IP (returns 429); `forgotEmail` = 3 per 60 min per address (silently returns the success message, no email); `forgotSentDaily` = 40 per 24 h globally (silently returns the success message, no email).
- The email: subject `"Reset your Lodestar password"`, from `Lodestar <no-reply@n3el.dev>`, button links to **`{APP_URL}/reset?token=<token>`** (a web URL). Token is 43 chars base64url (`[A-Za-z0-9_-]`), single use, expires in 1 hour, and requesting a new one invalidates the previous one.

### 3.8 `POST /api/account/reset` — set a new password from the emailed token

- Auth: none.
- Request body: `{ token: string, password: string }`. `token` max 100 chars; a malformed token is treated like a dead link (no distinct error).
- Effect: sets the new password, increments the session version (signs out every device), deletes outstanding reset tokens, then issues a new `ls_session` to **this** client (caller ends up signed in).
- Response `data`: `{}` (no user, no preferences; call `GET /api/account` afterwards to load them).
- Errors:
  | Status | `error` |
  |---|---|
  | 429 | `"Too many attempts. Try again in 15 minutes."` |
  | 400 | `"Choose a password of at least 8 characters."` |
  | 400 | `"This reset link is no longer valid. Request a new one."` (wrong, used, expired or superseded token) |
  | 403 / 413 / 400-JSON | section 1 |
  | 500 | `"The password reset failed. Try again."` |
- Rate limit: `reset` = 10 per 15 min per IP.
- **Native gap:** the emailed link is `https://lodestar.xanom.co/reset?token=...`. There is no `apple-app-site-association` file in the web app, so the link opens Safari, not the app, and resets the password in Safari's cookie jar (the app remains signed out but can then log in with the new password). Options: (a) accept that flow (it works with no backend change: the user resets on the web, then signs in in the app); (b) add a "Paste reset link" field in the app that extracts `token` from the URL query; (c) later, add Universal Links (needs `/.well-known/apple-app-site-association` served by the web app, which is a backend change not made here).

---

## 4. Preferences (`lib/preferences.ts`, `app/api/preferences/route.ts`)

### 4.1 Schema

Every field has a default; the full object is always returned. Arrays are de-duplicated server-side (first occurrence kept, order preserved). Strings are trimmed; codes are uppercased.

| Field | JSON type | Allowed values / constraints | Default |
|---|---|---|---|
| `homeAirports` | `string[]` | each: 3 letters `^[A-Z]{3}$` after trim+uppercase (error `"Use a three-letter airport code."`); max 4 items | `[]` |
| `alliances` | `string[]` | each one of `"STAR_ALLIANCE"`, `"ONEWORLD"`, `"SKYTEAM"`; max 3 | `[]` |
| `preferredAirlines` | `string[]` | each: `^[A-Z0-9]{2}$` after trim+uppercase (error `"Use a two-character airline code."`); max 10 | `[]` |
| `avoidedAirlines` | `string[]` | same as above; max 20 | `[]` |
| `cabin` | `string` | `"ECONOMY"`, `"PREMIUM_ECONOMY"`, `"BUSINESS"`, `"FIRST"` | `"ECONOMY"` |
| `stops` | `string` | `"ANY"`, `"0"`, `"1"`, `"2"` (strings, not numbers) | `"ANY"` |
| `adults` | `integer` | 1...9 (web UI offers 1...6) | `1` |
| `bags` | `integer` | 0...2 (checked bags) | `0` |
| `avoidRedEyes` | `bool` | | `false` |
| `avoidSelfTransfer` | `bool` | | `true` |
| `noBasicEconomy` | `bool` | | `false` |
| `trustedOnly` | `bool` | | `true` |
| `nearby` | `bool` | hack: also search nearby airports | `true` |
| `flexible` | `bool` | hack: ±3 days | `true` |
| `split` | `bool` | hack: two one-ways | `true` |
| `cuisines` | `string[]` | each a Taste (below); max 12 | `[]` |
| `dietary` | `string[]` | each a Taste; max 8 | `[]` |
| `diningBudget` | `string \| null` | `"$"`, `"$$"`, `"$$$"`, `"$$$$"`, or `null` | `null` |
| `interests` | `string[]` | each a Taste; max 12 | `[]` |
| `pace` | `string` | `"relaxed"`, `"balanced"`, `"packed"` | `"balanced"` |
| `hotelBudget` | `integer \| null` | 20...5000 (USD per night), or `null` | `null` |
| `hotelPriorities` | `string[]` | each a Taste; max 8 | `[]` |

**Taste** string: trimmed, 1...40 chars, regex `^[\p{L}\p{N}\s&'’,.()/-]+$` (Unicode letters, digits, whitespace, `& ' ’ , . ( ) / -`). Error `"Use plain words."`. Free text is allowed alongside the suggested chips.

Suggested chip choices (UI constants, not enforced by the server; display in this order):
- `CUISINE_CHOICES`: Local food, Seafood, Italian, Japanese, Mexican, Indian, Thai, Chinese, Middle Eastern, French, Steakhouse, Street food, Cafés & bakeries, Fine dining
- `DIETARY_CHOICES`: Vegetarian, Vegan, Pescatarian, Gluten-free, Halal, Kosher, Dairy-free, Nut allergy
- `INTEREST_CHOICES`: Museums, History, Food tours, Nature & hikes, Beaches, Nightlife, Shopping, Architecture, Art & galleries, Live music, Sports, Markets, Wellness & spas, Kid-friendly
- `HOTEL_PRIORITY_CHOICES`: Walkable location, Near transit, Quiet, Pool, Gym, Breakfast included, Free cancellation, Boutique, Big chain points, Views

Display labels (UI):
- Alliance: `STAR_ALLIANCE` "Star Alliance", `ONEWORLD` "oneworld", `SKYTEAM` "SkyTeam"
- Cabin: `ECONOMY` "Economy", `PREMIUM_ECONOMY` "Premium economy", `BUSINESS` "Business", `FIRST` "First"
- Stops: `ANY` "Any", `"0"` "Nonstop only", `"1"` "1 stop or fewer", `"2"` "2 stops or fewer"
- Adults: "1 adult", "2 adults", ... "6 adults"
- Bags: 0 "None", 1 "1 checked bag", 2 "2 checked bags"
- Pace: `relaxed` "Relaxed", `balanced` "Balanced", `packed` "See everything"
- Dining budget chips show the literal `$`...`$$$$` in Geist Mono; tapping the selected one clears it to `null`.

Swift guidance: model enums as `String`-backed enums (`Cabin`, `MaxStops` with raw values `"ANY"`, `"0"`, `"1"`, `"2"`, `Alliance`, `PriceLevel`, `Pace`). Decode leniently: use `decodeIfPresent` with the defaults above for every field, because stored preferences may predate a field (the server already fills defaults, but this keeps the app robust to new server fields and old caches). Provide `Preferences.default`.

### 4.2 `PUT /api/preferences` — replace saved preferences

- Auth: **required**.
- Request body: a `Preferences` object. **This is a full replace, not a patch**: any omitted field is reset to its default. Always send the whole object. Unknown keys are ignored.
- Validation is strict (unlike register): the first invalid field fails the request.
- Response `data`: `{ preferences: Preferences }` (the normalized, de-duplicated object that was saved; adopt it).
- Errors:
  | Status | `error` |
  |---|---|
  | 401 | `"Sign in to save preferences."` (checked first) |
  | 429 | `"Too many saves. Try again in a few minutes."` |
  | 400 | first zod issue message, e.g. `"Use a three-letter airport code."`, `"Use a two-character airline code."`, `"Use plain words."`, or zod's generic text for enum/range/type/too-many-items errors (e.g. `"Too big: expected array to have <=4 items"`, `"Invalid option: expected one of ..."`). Validate on device first so these are rare. |
  | 400 / 403 / 413 | section 1 |
  | 500 | `"The preference save failed. Try again."` |
- Rate limit: `preferences` = 120 per 15 min per IP.
- There is no `GET /api/preferences`. Read preferences from `GET /api/account` (or login/register responses).

### 4.3 How the web app uses preferences (match this natively)

- Signed out: preferences live only in memory (not persisted, not in localStorage). "Save" applies them for this session; the dialog footer reads "These apply now. Create an account to keep them." and the button reads "Use for now". Natively you may keep them in memory the same way (persisting locally would be a new feature).
- Signing up sends the in-memory preferences in `register.preferences`, so nothing set before sign-up is lost.
- Signed in: "Save preferences" calls `PUT /api/preferences`; on error the dialog stays open and shows the message in danger color above the buttons; on success it closes.
- After any save or sign-in: the search form's `from` is filled with `homeAirports` only if the form's `from` is empty; `cabin`, `stops`, `adults`, `bags`, `nearby`, `flexible`, `split` are copied into the form; `trustedOnly` sets the results' trusted-sellers toggle. If results are on screen, the search re-runs with the new preferences.
- Every flight search request adds: `alliances`, `avoidAirlines` (= `avoidedAirlines`), `preferAirlines` (= `preferredAirlines`), `noBasicEconomy`, `avoidRedEyes`, `avoidSelfTransfer`. (Note the renamed keys; see the search contract.)
- Under the search form, chips summarise active filters in this order: `"<Alliance label> only"` per alliance, `"Prefer AA, BA"`, `"Never XX, YY"`, `"No red-eyes"`, `"No basic economy"`, `"No self-transfers"`, then a link "Edit preferences" (signed in) or "Set alliances and preferences · create an account to keep them" (signed out).
- Signing out resets preferences to defaults.

### 4.4 Travel preferences screen (layout, from `preferences-dialog.tsx`)

Title "Travel preferences". Sections in order, separated by hairlines:
1. **Where you fly from**: airport picker "Home airports (filled in for new searches)", placeholder "City or airport", max 4.
2. **Airlines**: alliance chips "Alliances (only show these)" with hint "Leave all off to see every airline. Google also includes close partners of an alliance."; airline picker "Prefer these airlines (ranked higher, e.g. where you have status)" max 10; airline picker "Never show these airlines" max 20 (placeholder "Airline name or code").
3. **Trip defaults**: Cabin, Stops, Travellers (1...6 adults), Checked bags (0...2) pickers in a 2-column grid.
4. **Comfort and sellers**: toggles "Avoid red-eyes", "Avoid self-transfers", "No basic economy", "Trusted sellers only".
5. **Hacks to run on every search**: toggles "Nearby airports", "±3 days", "Two one-ways".
6. **Food, for Trips' dining plans**: chips "Food you love" (cuisines, max 12), "Dietary needs" (max 8), "Usual dinner budget" ($...$$$$, single select, deselectable).
7. **Things to do and hotels**: chips "What you like doing" (interests, max 12); "Pace" (single select: Relaxed / Balanced / See everything); chips "In a hotel you care about" (max 8); numeric field "Hotel budget per night (USD, optional)", placeholder "250", digits only, max 4 digits; on commit a value under 20 clears to `null`.

Chip fields: the suggested choices first, then any custom values already selected, then a dashed "Other…" text box; Return or losing focus adds the typed value after stripping characters outside the Taste regex and cutting to 40 chars; ignored if empty, a duplicate, or the list is at its max. Tapping a chip at max does nothing.

Footer: left text "Signed in as <email>" (signed in) or "These apply now. Create an account to keep them." (signed out); buttons "Sign out" (signed in; signs out and closes) or "Create account" (signed out; adopts the edits and opens Create account); primary "Save preferences" / "Use for now" (shows "Saving…" while busy).

The airport/airline pickers use `GET /api/airports` and `GET /api/airlines` (covered in the search contract).

---

## 5. Account UI (from `account-dialog.tsx`, `reset-form.tsx`, `app.tsx`)

One sheet with three modes:

| Mode | Title | Fields | Primary button | Links |
|---|---|---|---|---|
| `signin` | "Sign in" | Email, Password (`current-password`) | "Sign in" | "Create an account" (accent) left; "Forgot password?" (muted) right |
| `register` | "Create an account" | intro text, Email, Password with hint "At least 8 characters." (`new-password`, min 8) | "Create account" | "Have an account? Sign in" |
| `forgot` | "Reset your password" | Email | "Email me a reset link" | "Back to sign in" |

- Register intro text: "An account saves your travel preferences (home airports, alliances, airlines to prefer or avoid) and applies them to every search, on any device."
- While a request runs the primary button reads "One moment…" and is disabled.
- Errors show under the fields in danger color; the forgot `message` shows in body color.
- Switching modes clears error and notice. Password is cleared on success. Fallback error text: "That didn't work. Try again."
- Use iOS text content types `.username`/`.emailAddress`, `.password`, `.newPassword` so Keychain/Passwords autofill works.
- After login/register success: set account, adopt returned preferences (fills search form), refresh AI status. If the user had opened a signed-in-only link (a trip link, `connect=flint`), go there. Else, if this was a **register**, start onboarding (section 6).
- Header: signed out shows a quiet "Sign in" button; signed in shows a pill with the email's local part (before `@`) that opens Travel preferences. The **Trips** tab only exists when signed in (`Search`, `Stays`, `Plan`, `Trips`; signed out: `Search`, `Stays`, `Plan`).

Reset screen (web `/reset`): hero "Choose a new password" (Geist Serif, 44pt); field "New password" with hint "At least 8 characters."; button "Set new password" ("Saving…" while busy; disabled with no token). Missing token shows "This link is missing its code. Open the link from the email again." Success shows: "Your password is changed and you're signed in. Every other session was signed out." with a "Back to Lodestar" link.

---

## 6. Onboarding (`components/onboarding.tsx`) — after **register only**

A sheet titled "Set up Lodestar". It is seeded with the current preferences (which already include anything set before sign-up). 9 pages total: 8 question pages + 1 AI page. A progress bar of 9 equal segments (4pt tall, full-radius, 4pt gaps) fills in accent up to and including the current page; the rest are `line-2`. Each page enters with the "rise" animation (8pt up + fade, 250 ms).

| # | Title | Hint | Controls |
|---|---|---|---|
| 1 | Where do you usually fly from? | Your home airports fill in new searches, and Plan uses them when you don't say where you're leaving from. | Airport picker "Home airports" (`homeAirports`) |
| 2 | Do you stick to an alliance? | Handy if you collect miles or have status. Leave it blank to see every airline. | Alliance chips (`alliances`); airline picker "Airlines to rank higher (optional)" (`preferredAirlines`, max 10) |
| 3 | Any airlines you'd rather skip? | They won't show up in search results or in Plan. | Airline picker "Never show these airlines" (`avoidedAirlines`, max 20) |
| 4 | How do you usually travel? | The defaults for new searches. You can change them on any search. | Cabin, Travellers (1...6) |
| 5 | Bags and stops? | Prices include checked bags when you add them, so the cheapest fare is the real cheapest. | Checked bags, Stops |
| 6 | Anything you won't fly? | Turn these on to hide those flights everywhere. | Toggles "Red-eyes" (`avoidRedEyes`), "Basic economy" (`noBasicEconomy`) |
| 7 | How do you like to eat when you travel? | Trips uses this when you ask for a dining plan. Pick a few, or skip. | Dining fields (cuisines, dietary, dinner budget) as in 4.4 |
| 8 | And the rest of the day? | For activity ideas and hotel picks on your trips. | Doing fields (interests, pace, hotel priorities, hotel budget) as in 4.4 |
| 9 (AI) | not connected: "Last step: connect your AI." / connected: "Plan is ready to go." | not connected: "Plan turns a sentence like “Chennai over the holidays, nonstop if it's close” into several live searches and a shortlist. It runs on your own ChatGPT or Grok subscription, and the connection is saved to your account." / connected: "Your AI account is connected. Next, a quick look at how Plan works." | none |

Footer behaviour:
- "Back" (ghost) on every page after the first.
- Question pages: "Skip" (muted text) and primary "Next". On pages 1-7 both just advance (Skip does not discard edits made on that page; it only advances). On page 8, both **Skip and Next save** (`PUT /api/preferences` with the whole object), showing "Saving…"; on error the message shows above the buttons and the page stays; on success go to page 9. Saving before the AI page means closing on page 9 keeps the answers.
- AI page: not connected: "Maybe later" (ghost) and primary "Connect ChatGPT or Grok" (opens the AI connect sheet; the tour starts when that sheet closes). Connected: only "Continue".
- Closing the sheet (X / swipe down) at any point = done: it does **not** save (unless page 8 was already passed) and starts the tour.
- Connected state comes from `GET /api/ai/status` -> `data.connected.codex || data.connected.grok` (AI contract).

## 7. Tour (`components/tour.tsx`) — after onboarding

A coach-mark overlay: dims the screen (black 60%), outlines one element with a 2pt accent border (8pt radius, 6pt padding), and shows a card (max 320pt wide, 16pt side gutter, 12pt below the element; if the element isn't visible the card sits alone near the top) with "N of M" (caption, `ash`, tabular figures), title (15pt medium, `ink`), body (13pt, `body`), and buttons "Skip tour" (muted, left), "Back" (ghost, after first), primary "Next" / "Done" on the last. Tapping the dim area ends the tour. Steps whose element is hidden are dropped. The tour first switches to the Plan tab.

Steps (target -> title: body):
1. Plan tab -> "Plan": "Start here. Plan finds flights from a plain sentence instead of a form."
2. Plan input box -> "Say the trip": "Type where and roughly when, like “Chennai Dec 7 to 20, nonstop if it's close”. Plan runs several live searches with your preferences and shortlists the best options. Reply to change anything."
3. Search tab -> "Search": "Prefer a form? Search shows live fares and also tries nearby airports, a few days either side, and two one-way tickets."
4. Trips tab -> "Trips": "All your trips, day by day. Forward a confirmation or connect Flint and it files itself. Saved Plan shortlists are watched here too, with an email when the fare drops."
5. Preferences button -> "Your preferences": "Everything you just set lives here. Change it any time."
6. Account pill -> "Your account": "Click your name for preferences, your AI connection and sign out." (on iOS, say "Tap" instead of "Click").

No server state records whether onboarding or the tour was shown; it runs once, right after a successful register. (The web replays it in development with `/?welcome`.)

---

## 8. Rate limits

Two mechanisms exist. The account and preferences routes use the **database-backed fixed window** in `lib/server/limits.ts` (`allow(name, key)`): a window starts at the first hit and lasts the window length; the request that exceeds the limit is refused. Keys are an HMAC of the client IP (`x-real-ip`, else last `x-forwarded-for` entry), so devices behind one carrier NAT share a bucket. No `Retry-After` header is sent; use the message text.

| Name | Limit | Window | Key | On exceed |
|---|---|---|---|---|
| `login` | 10 | 15 min | IP | 429 "Too many attempts. Try again in 15 minutes." |
| `register` | 5 | 60 min | IP | 429 "Too many new accounts from here. Try again later." |
| `forgot` | 5 | 15 min | IP | 429 "Too many attempts. Try again in 15 minutes." |
| `forgotEmail` | 3 | 60 min | normalized email | silent: same success message, no email |
| `forgotSentDaily` | 40 | 24 h | global | silent: same success message, no email |
| `reset` | 10 | 15 min | IP | 429 "Too many attempts. Try again in 15 minutes." |
| `preferences` | 120 | 15 min | IP | 429 "Too many saves. Try again in a few minutes." |

`GET /api/account`, `POST /api/account` (sign out everywhere), `DELETE /api/account` and `POST /api/account/logout` have no rate limit. (Other limits in `LIMITS`, e.g. `trips`, `journeys`, `places`, `mcp`, belong to other contracts. `lib/api.ts` also has an in-memory per-minute `rateLimited()` used by other routes, not these.)

Native client: never retry 429 automatically; show the message and re-enable the button.

---

## 9. Endpoint summary

| # | Method | Path | Auth | Body | `data` |
|---|---|---|---|---|---|
| 1 | GET | `/api/account` | optional | none | `{user: {email, createdAt}?, preferences: Preferences?}` |
| 2 | POST | `/api/account/register` | none | `{email, password, preferences?}` | `{user: {email}, preferences}` + cookie |
| 3 | POST | `/api/account/login` | none | `{email, password}` | `{user: {email}, preferences}` + cookie |
| 4 | POST | `/api/account/logout` | none | `{}` (ignored) | `{}`, clears cookie |
| 5 | POST | `/api/account` | required | `{action: "signout-everywhere"}` | `{}` + new cookie |
| 6 | DELETE | `/api/account` | required | `{password}` | `{}`, clears cookie |
| 7 | POST | `/api/account/forgot` | none | `{email}` | `{message}` |
| 8 | POST | `/api/account/reset` | none | `{token, password}` | `{}` + cookie |
| 9 | PUT | `/api/preferences` | required | `Preferences` (full) | `{preferences}` |

---

## 10. Design tokens (from `app/globals.css` + `~/DESIGN.md`), Swift-ready

The web is **dark by default**; light applies when the system is light (or the user picks light in the theme toggle, which cycles System -> Light -> Dark and is stored per device). Natively: follow `colorScheme`, with an optional per-device override (`system`/`light`/`dark`) in `UserDefaults`. Status bar / theme color: `#000000` dark, `#FCFCFD` light.

### 10.1 Colors

Hex with alpha written as `#RRGGBB` + opacity. Build as an asset catalog color set with Any/Dark appearances, or `Color(light:dark:)`.

| Token (Swift name) | CSS var | Dark | Light | Use |
|---|---|---|---|---|
| `canvas` | `--canvas` | `#000000` | `#FCFCFD` | screen background |
| `card` | `--card` | `#0A0A0C` | `#FFFFFF` | cards, sheets |
| `elevated` | `--elev` | `#111114` | `#F4F5F7` | ghost buttons, selected chips, pills, skeletons |
| `deep` | `--deep` | `#06060A` | `#F7F8FA` | text inputs, selects (inset panel) |
| `ink` | `--ink` | `#FCFDFF` | `#0A0A0C` | primary text, titles |
| `body` | `--body` | `#FCFDFF` @ 0.86 | `#0A0A0C` @ 0.82 | body text |
| `charcoal` | `--charcoal` | `#FCFDFF` @ 0.70 | `#0A0A0C` @ 0.66 | field labels, secondary icons |
| `mute` | `--mute` | `#A1A4A5` | `#5F6366` | hints, unselected chips, secondary text |
| `ash` | `--ash` | `#888E90` | `#7A7F82` | captions, counters, close icon |
| `stone` | `--stone` | `#464A4D` | `#C4C7CA` | placeholders, off toggle track |
| `hairline` | `--line` | `#FFFFFF` @ 0.06 | `#000000` @ 0.06 | section dividers |
| `hairlineStrong` | `--line-2` | `#FFFFFF` @ 0.14 | `#000000` @ 0.12 | card/input/chip borders, empty progress segment |
| `hairlineHover` | `--line-3` | `#FFFFFF` @ 0.30 | `#000000` @ 0.28 | selected chip border, pressed borders |
| `hover` | `--hover` | `#FFFFFF` @ 0.04 | `#000000` @ 0.035 | pressed row / selected segment fill |
| `primary` | `--primary` | `#FCFDFF` | `#0A0A0C` | primary button fill (the brightest thing) |
| `primaryOn` | `--primary-on` | `#000000` | `#FCFDFF` | primary button text |
| `primaryPressed` | `--primary-hover` | `#E8F0FF` | `#26262B` | primary pressed |
| `accent` | `--accent` | `#4C8DFF` | `#2F6FE0` | the one color: links, focus, toggles on, progress |
| `accentPressed` | `--accent-hover` | `#6FA3FF` | `#2459BA` | accent pressed |
| `accentOn` | `--accent-on` | `#000000` | `#FFFFFF` | text on accent fill |
| `tint` | `--tint` | `#4C8DFF` @ 0.12 | `#2F6FE0` @ 0.08 | accent badge background |
| `ring` | `--ring` | `#4C8DFF` @ 0.55 | `#2F6FE0` @ 0.45 | 3pt focus ring |
| `ok` | `--ok` | `#3DD68C` | `#14915A` | status dot only |
| `warn` | `--warn` | `#FFC53D` | `#B7791F` | status dot only |
| `danger` | `--danger` | `#FF4D5E` | `#D92D3F` | status dot, inline error text, destructive |
| `scrim` | `--scrim` | `#000000` @ 0.70 | `#0A0A0C` @ 0.40 | sheet backdrop |

Rules: green/yellow/red only as 8pt status dots beside a label (and `danger` for error text). No gradients, no shadows: depth is luminance steps plus 1pt hairlines. One primary button per screen.

### 10.2 Typography

Fonts to bundle (from `node_modules/geist/dist/fonts`):
- `geist-sans/Geist-Variable.ttf` (or Regular/Medium `.ttf`) -> family "Geist"
- `geist-mono/GeistMono-Variable.ttf` (or Regular `.ttf`) -> "Geist Mono"
- `geist-serif/GeistSerifVF.woff2` -> "Geist Serif". **Only shipped as WOFF2.** Convert to TTF before bundling (e.g. `python3 -m fontTools.ttLib.woff2 decompress GeistSerifVF.woff2`, needs `fonttools` + `brotli`), or verify the iOS 26 CoreText registration accepts WOFF2 before relying on it. Register via `UIAppFonts` in Info.plist.

Use `Font.custom(_:size:relativeTo:)` so Dynamic Type scales.

| Style | Family | Size | Weight | Line height | Tracking | Where |
|---|---|---|---|---|---|---|
| `displayXXL` | Geist Serif | 96 | 400 | 1.0 | -0.02em | hero (web clamps 44...88) |
| `displayXL` | Geist Serif | 72 | 400 | 1.0 | -0.02em | hero |
| `display` (reset page) | Geist Serif | 44 | 400 | 1.0 | -0.02em | "Choose a new password" |
| `displayLG` | Geist | 48 | 400 | 1.1 | -0.04em | large sans heading |
| `headingMD` | Geist | 22 | 500 (onboarding titles use 400) | 1.4 | -0.01em | onboarding page title |
| `headingSM` | Geist | 18 | 500 | 1.35 | 0 | wordmark |
| `subtitle` | Geist | 19 | 400 | 1.45 | 0 | |
| `bodyLG` | Geist | 17 | 400 | 1.6 | 0 | hero paragraph (web 18) |
| `bodyMD` | Geist | 15 | 400 | 1.55 | 0 | tour title (500) |
| `bodySM` | Geist | 14 | 400 | 1.45 | 0 | inputs, onboarding hint |
| `button` | Geist | 14 | 500 | 1.43 | 0 | buttons (sm: 13) |
| `chip` | Geist | 13 | 400 | | 0 | chips, toggles, error/notice text |
| `label` | Geist | 12 | 400 | 1.5 | 0 | field labels (`charcoal`) |
| `caption` | Geist | 12 | 400 | 1.5 | 0 | pills, badges, footers (`ash`) |
| `hint` | Geist | 11 | 400 | | 0 | field hints (`ash`) |
| `code` | Geist Mono | 13 | 400 | 1.65 | 0 | IATA/airline codes, $ levels, PNRs |

Rules: serif only at 40pt and above (hero and section openers). Body weight stays 400; emphasis is a color step (`body` -> `ink`), not bold. Numbers that line up use tabular figures (`.monospacedDigit()`). Tracking in em: multiply by point size (e.g. -0.02em at 44pt = -0.88pt).

### 10.3 Radii, spacing, sizes

| Token | Value | Use |
|---|---|---|
| `radiusXS` | 4 | |
| `radiusSM` | 6 | focus ring corners |
| `radiusMD` | 8 | buttons, inputs, selects, tour highlight |
| `radiusLG` | 12 | cards, tour card |
| `radiusXL` | 16 | sheets/dialogs |
| `radiusFull` | 9999 (Capsule) | pills, chips, toggles, dots, progress segments |
| spacing | 2, 4, 8, 12, 16, 24, 32, 48, 96, 128 | `xxs xs sm md lg xl xxl xxxl section band` |
| side gutter | 16 (phone) | |
| hairline | 1pt (use `1 / displayScale` only if you want true pixel lines; web uses 1 CSS px) | |
| button height | 36 (web uses 44 on phones) | use 44 on iOS for touch |
| small button | 32 | |
| input height | 40 (48 on phones) | use 48 on iOS |
| chip height | 36 (40 on phones) | |
| toggle chip | 32 (40 on phones); track 24x14, knob 10, knob inset 2 | |
| nav bar | 64, canvas background, hairline bottom, no blur | |
| status dot | 8 (6 inside pills) | |
| sheet padding | 20; header/footer 20x16, separated by `hairline` | |
| card padding | 32 (feature cards), 16 (tour card) | |

### 10.4 Components (native equivalents)

- **Button primary**: `primary` fill, `primaryOn` text, radius 8, 14pt medium; pressed `primaryPressed`; disabled opacity 0.4.
- **Button accent**: `accent` fill, `accentOn` text.
- **Button ghost**: `elevated` fill, `ink` text, 1pt `hairlineStrong` border (pressed `hairlineHover`).
- **Button outline**: `canvas` fill, `ink` text, `hairlineStrong` border.
- **Button quiet**: no fill, `charcoal` text (pressed `ink`).
- **Text input**: `deep` fill, 1pt `hairlineStrong` border, radius 8, 14pt `ink`, placeholder `stone`; focused border `accent` + 3pt `ring`.
- **Chip** (multi or single select): capsule, 13pt; off: `hairlineStrong` border, `mute` text; on: `hairlineHover` border, `elevated` fill, `ink` text. "Other…" input chip: dashed `hairlineStrong` border, transparent fill, 112pt wide.
- **Toggle chip**: capsule with a mini switch (track `accent` on / `stone` off, knob `canvas`) and a label; same on/off border and text colors as chips.
- **Pill**: capsule, 12pt, `elevated` fill, `body` text, padding 4x10; accent variant `tint` fill + `accent` text; optional 6pt status dot.
- **Card**: `card` fill, 1pt `hairlineStrong` border, radius 12.
- **Sheet**: `card` fill, `hairlineStrong` border, radius 16, `scrim` backdrop, title 16pt medium, fixed header and footer with body scrolling between them.
- **Skeleton**: `elevated` fill, `hairline` border, opacity breathing 1 -> 0.55 -> 1 over 1.6 s.
- **Spinner**: 14pt ring, 1.5pt `hairlineStrong` with `ink` top segment.

### 10.5 Motion

- Easing `cubic-bezier(0.2, 0, 0, 1)` -> `Animation.timingCurve(0.2, 0, 0, 1, duration:)`.
- Color/border transitions 150 ms.
- "rise": enter with 8pt upward offset + fade, 250 ms; stagger 40 ms in lists.
- Honor Reduce Motion: no rise, no breathing, no transitions.

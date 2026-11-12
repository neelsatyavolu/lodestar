# Lodestar iOS: architecture

Native SwiftUI client for the Lodestar web app. iOS 26+, Swift 6 strict concurrency, `@Observable`,
async/await `URLSession`, no third-party packages. Read this file and your area's contract
(`api-search.md`, `api-trips.md`, `api-account.md`). The contracts own endpoint behaviour and copy;
this file owns how the app is put together.

## Build and test

```bash
cd ios
xcodegen generate     # project.yml -> Lodestar.xcodeproj (generated, gitignored)
xcodebuild -project Lodestar.xcodeproj -scheme Lodestar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/claude-503/<your-dir> build      # or: test
```

Sources are folder globs, so new files need no project edits; re-run `xcodegen generate` after
adding files. Tests use Swift Testing (`import Testing`, `@Test`, `#expect`) in `LodestarTests/`.
Use your own `-derivedDataPath` so parallel builds don't collide.

Base URL: `https://lodestar.xanom.co` (Info.plist `LodestarBaseURL`). Point at a dev server with the
launch argument `-apiBaseURL http://localhost:3000` (ATS allows local networking).

## Folder layout

```
ios/
  project.yml                  XcodeGen spec (targets Lodestar, LodestarTests)
  Lodestar/
    App/                       Entry point, AppState, RootView (tabs + app-wide sheets)
    Core/
      Networking/              APIClient, Endpoint, Envelope/ResponseDecoder, APIError, APIConfig
      Endpoints/               API.<Area>.<call>() factories for every endpoint
      Models/                  Codable models for every contract, grouped by area
    Design/
      Theme/                   Colors, Typography, Metrics (spacing, radii, sizes, motion)
      Components/              Shared views (buttons, cards, fields, logos, states, ...)
      Format/                  Money, dates, durations, clock text
    Features/
      Search/   SearchRootView.swift          (Search agent)
      Stays/    StaysRootView.swift           (Stays agent)
      Plan/     PlanRootView.swift, AIConnectSheet.swift            (Plan agent)
      Trips/    TripsRootView.swift           (Trips agent)
      Account/  AccountRootView.swift, SignInSheet.swift,
                PreferencesSheet.swift, OnboardingView.swift         (Account agent)
    Resources/                 Assets.xcassets, Fonts/ (Geist, Geist Mono, Newsreader TTFs, OFL licences)
  scripts/                     release.sh (TestFlight upload), asc-builds.mjs (build status)
  LodestarTests/               Swift Testing suites
  docs/                        This file and the API contracts
```

### Ownership rules (parallel work)

- Each feature agent edits only `Lodestar/Features/<Name>/` and adds tests as
  `LodestarTests/<Name>*Tests.swift`. Organise subfolders inside your feature freely.
- Replace the placeholder files listed above, but **keep their type names and initialisers**
  (`SearchRootView()`, `AIConnectSheet()`, `SignInSheet(startMode:)` with `SignInSheet.Mode`,
  `PreferencesSheet()`, `OnboardingView()`): `RootView` references them.
- `App/`, `Core/` and `Design/` are shared. Don't edit them. If you need a missing model field,
  endpoint or component, build it inside your feature folder (as an extension if it fits) and
  list it in your result so it can be promoted later.
- Prefix any type you add with your feature name when it could collide (e.g. `SearchFormModel`,
  `TripsListModel`), since every file is in one module.
- Do not change the backend. Report gaps instead.

## Talking to the API

`APIClient` (one per app, owned by `AppState.api`) holds one `URLSession` with
`HTTPCookieStorage.shared`, so the `ls_session`, `ls_device` and AI PKCE cookies flow on every
call. It never sends `Origin`; non-GET calls without a body send `{}`.

```swift
@Environment(AppState.self) private var app

let result = try await app.api.send(API.Flights.search(query.applying(app.preferences)))
let days   = try await app.api.send(API.Flights.calendar(query))          // [DayPrice]
for try await event in app.api.stream(API.AI.canvas(request)) { ... }    // NDJSON (Plan)
```

- Every endpoint in the three contracts has a factory in `Core/Endpoints/`:
  `API.Flights`, `API.Logos`, `API.Stays`, `API.AI`, `API.Account`, `API.Journeys`,
  `API.SavedTrips`, `API.Places`, `API.Connectors`, `API.Agents`. Each sets the route's timeout
  (`Timeouts.live` 70 s, `.ai` 310 s, `.wanderlog` 130 s).
- `send` returns the unwrapped `data`. It throws `APIError` (show `.message`, it's already
  user-facing: the server's sentence, "Request failed (HTTP n).", or "Can't reach Lodestar. Check
  your connection.") or `CancellationError` (show nothing). Check `error.isCancellation`.
- Route every caught error through `app.handle(error)`. It returns the message to show (nil for
  cancellation) and drops to signed-out when the 401 is a sign-in 401. `APIError.needsAIConnection`
  tells the AI-not-connected 401 apart; respond with `app.present(.connectAI)`.
- 429: show the message, re-enable the button, never retry automatically (`isRateLimited`).
- `stream` (canvas) skips lines that don't decode, yields `CanvasEvent`s, throws the error envelope
  on a non-200, and cancels the request when the consuming task is cancelled.
- Images (`/api/logo/*`, `/api/places/photo`, hotel thumbnails) go through `ImageLoader`
  (environment `\.imageLoader`) via `LogoView` and `RemoteImage`; never through `send`.

## Models

All in `Core/Models/`, immutable `let` structs (request bodies are `var` so you can build them).

| File | Types |
|---|---|
| `SharedEnums` | `Cabin`, `MaxStops`, `Alliance`, `SellerTier`, `AIProvider` (with labels) |
| `Itinerary` | `Itinerary`, `FlightSlice`, `FlightLeg`, `AirlineRef` (`displayName` applies `AirlineNames`), `Amenities`, `Layover` |
| `FlightSearch` | `SearchQuery` (`applying(_ prefs:)`), `CalendarQuery`, `SearchResult`, `DayPrice`, `AirportSuggestion`, `AirlineSuggestion` |
| `Hack` | `Hack`, `HackKind` (symbol, action label), `HackApply` (`applied(to:)`), `CanvasHack` |
| `Sellers` | `SellerCheckRequest(itinerary:)`, `SellerCheck`, `PriceInsight`, `VerifiedSeller`, `Fare`, `FarePolicy`, `ChangePolicy`, `RefundPolicy`, `SeatPolicy` |
| `Stays` | `StaySearchQuery`, `StayPricesQuery`, `StaySearchResult`, `Hotel`, `StayPrices`, `StayOffer`, `StayFlexResult`, `FlexSaving` |
| `AIConnection` | `AIStatus` (`defaultProvider`), `AIModel`, `AISignInStart`, `AISignInComplete`, `AIConnected`, `AIDisconnected` |
| `PlanCanvas` | `CanvasRequest`, `CanvasContext`, `CanvasTurn`, `CanvasDefaults`, `SearchFilters`, `CanvasEvent`, `SearchProgress`, `CanvasResult`, `CanvasOption`, `TripPlan` (the API's `Plan`), `PlannedSearch`, `Canvas`, `Pick` |
| `Account`, `Preferences` | `AccountState`, `AccountProfile`, `AccountSession`, request bodies, `ResetRequest.token(fromLink:)`; `Preferences` (lenient decode, always encodes all 23 keys, `displayName(_:email:)`), `PriceLevel`, `Pace`, `TasteChoices` |
| `FlightStatus` | `FlightsResponse` (`GET /api/journeys/:id/flights`), `FlightStatus`, `FlightPhase`, `FlightEndpoint`, `FlightMoment` |
| `Journey`, `JourneyEnums` | `Journey` (`access`, `canEdit`, `isOwned` for trips shared by email), `JourneyAccess`, `JourneyWithItems`, `TripDetail` (`with(items:)`), `TripItem`, `ItemDetails`, `TripTask`, `TripNote`, `TripCost`, `MailSummary`; `ItemKind`, `ItemStatus`, `RecordSource`, `TripType`, `CostCategory`, `Meal`, `PlanPart`, `MailState`, `PlaceKind`, `GrantKind` |
| `JourneyRequests`, `JourneyResponses` | `NewJourney`, `JourneyPatch`, `NewItem`, `ItemPatch`, `ItemLocation`, `ItemFacts`, task/note/cost bodies and patches, `GenerateRequest`, `SuggestRequest`, `WanderlogImportRequest`; `JourneyList`, `CreatedID`, `JourneyResponse`, `GenerateResponse`, `ShareResponse`, `LegsResponse`, `LocateResponse`, `ReadMailResponse`, Wanderlog types |
| `SavedTrips` | `SavedTrip` (the API's `TripSummary`), `FareBooking`, `Snapshot`, `SaveTripRequest`, `SavedTripPatch`, `Lossy<T>` |
| `Places`, `Connectors` | `PlaceSearchResult`, `PlaceSuggestion`, `PlaceDetails`, `LatLng`; `ConnectorsState`, `FlintLink`, `FlintPairingCode`, `AgentsState`, `AgentGrant`, `AgentTokenCreated` |

Conventions baked into the models:
- **Dates** are `LocalDate` (wire `"YYYY-MM-DD"`, no time zone): `adding(days:)`, `days(to:)`,
  `LocalDate.today()` (device day, used for countdowns) and `todayUTC()` (server day).
- **Flight times** (`FlightLeg.depart/arrive`) stay `String`; format with `ClockText`.
- **Timestamps** are `EpochMillis` (`Int64` ms) with `.asDate`.
- **Enums** conform to `LenientEnum`: an unknown server value decodes as `.unknown` instead of
  failing. Switches must handle `.unknown`; pickers use `knownCases`.
- **PATCH bodies** use `T??`: `nil` omits the key, `.some(nil)` sends `null`, `.some(v)` sets.
  Example: `ItemPatch(facts: ItemFacts(reserve: .some(nil), bookBy: .some(nil)))`.
- The JSON key `return` is `returnDate` in Swift. `HackApply.returnDate` is tri-state.
- `ItemDetails` encodes only the keys you set (the server's schema is strict).

## AppState

`@MainActor @Observable final class AppState`, injected at the root; read it with
`@Environment(AppState.self) private var app`.

| Member | Use |
|---|---|
| `api`, `imageLoader` | the shared client and image cache |
| `session` (`.checking/.signedOut/.signedIn(profile)`), `account`, `isSignedIn` | who is signed in (decided only by `GET /api/account`) |
| `preferences`, `preferencesRevision` | current preferences (in memory when signed out); the revision bumps on every adopt so Search can re-apply them to its form |
| `aiStatus` | `connected`, `models`, `defaultProvider`; refresh with `refreshAIStatus()` after connect/disconnect |
| `selectedTab`, `present(_ sheet:)`, `sheet` | navigation; sheets are `.signIn`, `.register`, `.preferences`, `.connectAI` |
| `isOnboardingPresented` | set by `register`; RootView presents `OnboardingView` |
| `flightForm` | Search writes the current form here; Plan reads it as canvas `context` |
| `runFlightSearch(_:)`, `pendingFlightSearch` | another feature asks Search to run a query (switches tab); Search consumes and clears it |
| `signIn`, `register`, `signOut`, `deleteAccount(password:)`, `signOutEverywhereElse`, `requestPasswordReset(email:)`, `resetPassword(token:password:)`, `savePreferences(_:)`, `disconnectAI(_:)` | session actions; each updates shared state, throws `APIError` for the screen to show |
| `handle(_ error:)` | the error funnel described above |

Feature screen state belongs in the feature: an `@MainActor @Observable final class` model per
screen, created with `@State`, holding `LoadState<Value>` values and calling `app.api`.
Cancel in-flight work when a newer request replaces it (keep the `Task` and cancel it), and drop
answers that belong to an older request.

The Trips tab exists only while signed in. Signing out resets preferences to defaults and leaves
the Trips tab.

## Design system (Ink & Instrument, v3)

The web's `app/globals.css` tokens: warm off-black canvas (#0E0E0D) in dark mode, paper (#F7F5EF) in
light, by system setting (or `ThemePreference` stored under `@AppStorage(ThemePreference.storageKey)`;
`LodestarApp` applies it). Blue is the only color (the flight card's airline livery is the one
exception, as on the web). No shadows, gradients, blur or glass; depth is luminance steps plus 1 pt
hairlines. Newsreader for what people read (heroes, trip and hotel names, empty states), Geist for
UI, Geist Mono for numbers, codes, times and fact labels. Radii 4 pt (controls) and 6 pt (cards).

- **Colors** (`Color.<token>`): `canvas card elevated deep ink bodyText charcoal mute ash stone
  hairline hairlineStrong hairlineHover pressedFill primaryFill primaryOn primaryPressed accent
  accentPressed accentOn accentTint ring ok warn danger scrim`, plus `Color.dayColor(i)` for trip
  days. Write `.foregroundStyle(Color.ink)` (the tokens are on `Color`, not `ShapeStyle`).
  `ok/warn/danger` only as status dots (and `danger` for error text).
- **Type**: `.textStyle(.displayXL | .display | .headingMD | .headingSM | .bodyLG | .bodyMD |
  .bodySM | .button | .chip | .label | .caption | .hint | .code ...)` sets font, tracking and line
  spacing with Dynamic Type. Serif styles (`displayXXL/XL/display`, `headline`) are Newsreader: heroes and names only. Codes,
  IATA, PNRs and `$` levels use `.code`. Add `.monospacedDigit()` to numbers that line up.
- **Metrics**: `Spacing.xs…band`, `Spacing.gutter` (16), `Spacing.screenTop` (24, above every tab's hero), `Radius.md` (4,
  controls) / `.lg` (6, cards) / `.xl` (6), `Sizes.button` (44), `.buttonSmall` (36 drawn, 44 tap),
  `.minTap` (44), `.input` (48), `.chip` (40 drawn, 44 tap), `.hairline`. Motion: `Motion.fast`, `Motion.enter`, `.rise(delay:)` (honours Reduce Motion).
- **Components** (`Design/Components/`):
  - `Button(...).buttonStyle(.lodestar(.primary | .accent | .ghost | .outline | .quiet | .link | .destructive, small:, fullWidth:, isLoading:))`; `IconButton`. One primary per screen.
  - `Card { }`, `.card(padding:featured:)`, `Hairline`, `SectionHeader`, `HeroTitle(line1:line2:paragraph:)`.
  - `LodestarField` (label, hint, error, mono, secure, content type, submit).
  - `StatusDot(tone:)` / `StatusLabel`, `StatusDot.Tone(tier:)`, `Pill(text:style:dot:)`, `Chip`, `ToggleChip`, `Spinner`, `Skeleton`, `SkeletonList`, `SegmentedProgress`.
  - `LoadState<Value>`, `EmptyStateView`, `ErrorStateView` (with "Try again"), `LoadingStateView`, `InlineError`, `InlineNotice`.
  - `LogoView(airline:size:)` / `LogoView(path:name:size:)`: white tile, falls back to a drawn `Monogram` when the server sends its SVG monogram or the image fails. `RemoteImage(source:)` for thumbnails and `API.Places.photoPath(name:width:)`.
- **Formatting** (`Design/Format/Formatters.swift`): `Money.usd` ("$1,234", nil "—"),
  `Money.saving` ("−$120"), `Money.amount(_:currency:)` ("€30.50"), `DurationText.minutes`
  ("5h 20m"), `DurationText.leg` ("36 min · 23.7 mi"), `DateText.short` ("Thu, Nov 26"),
  `.monthDay`, `.long`, `.shortRange`, `.tripRange` ("Mar 1 – Mar 10, 2027"),
  `ClockText.time12` ("7:05 PM"), `.flightClock` ("8:15am"), `.dayShift`, `plural(_:_:_:)`.

## Conventions

- Files 200-400 lines (800 max), one screen or concern per file; functions under ~50 lines.
- Value types and `let` by default; produce new values instead of mutating shared ones.
- Explicit error handling: every `try` is caught and shown with the message, or deliberately
  ignored where the contract says the web ignores it (e.g. logout, `locate`).
- No hardcoded secrets. No speculative features: match the contract's screens and copy
  (iOS wording: "Tap" not "Click", "on this device" not "in this browser").
- Copy follows the contracts verbatim. No exclamation marks, no emoji.
- SwiftUI `View` types are `@MainActor`. Pure helpers declared on a view type and called from
  tests or background code must be `nonisolated static`, or live outside the view.
- Accessibility: label icon-only buttons, combine dot + label, support Dynamic Type.
- Tests: Swift Testing, realistic JSON fixtures copied from your contract, one suite per file.
  Test pure logic (ports of web helpers like `flexHack`, budget, nights/issues) without the network.

## Known native gaps (from the contracts; no backend changes)

- AI sign-in redirects to fixed loopback URIs (codex `localhost:1455`, grok `127.0.0.1:56121`).
  Plan implements the `NWListener` + `ASWebAuthenticationSession` flow from api-search.md 4.2 with
  the paste fallback always offered. Untested on a device.
- The flex-dates hack is computed on the client from `/api/calendar` (Search ports it).
- `/t/{token}` share pages are HTML only: share or open the URL (`SFSafariViewController`).
- Wanderlog import needs a pasted `connect.sid` (or a WKWebView sign-in that reads it).
- Password reset links open Safari (no Universal Links); Account offers a "paste reset link" field
  using `ResetRequest.token(fromLink:)`.
- The web has no delete-account screen; iOS needs one (`AppState.deleteAccount(password:)`).
- The tour (coach marks after onboarding) is an Account/onboarding concern; it needs anchors in
  other tabs, so implement it as an overlay that only highlights the tab bar items.

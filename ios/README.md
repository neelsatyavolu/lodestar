# Lodestar for iOS

The native SwiftUI app for Lodestar. It has the same features as the web app: flight search, Stays, Plan, Trips, the account screens, preferences and onboarding. It calls the web app's JSON API (`/api/*`) and signs in with the same session cookie. It needs iOS 26 or later, Xcode 27 and XcodeGen, and uses no third-party packages.

How the app is built is described in `docs/ARCHITECTURE.md`. The endpoint contracts are in `docs/api-*.md`.

## Generate the project

`Lodestar.xcodeproj` is generated from `project.yml` and is not committed.

```bash
cd ios
brew install xcodegen      # once
xcodegen generate
```

Sources are folder globs. After adding or removing files, run `xcodegen generate` again; `project.yml` does not need editing.

## Build and run

Open `Lodestar.xcodeproj` in Xcode and run the **Lodestar** scheme. To build from the command line:

```bash
xcodebuild -project Lodestar.xcodeproj -scheme Lodestar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/lodestar-dd build
```

To install and launch on a booted simulator:

```bash
xcrun simctl install booted /tmp/lodestar-dd/Build/Products/Debug-iphonesimulator/Lodestar.app
xcrun simctl launch booted co.xanom.lodestar
```

Debug builds accept launch arguments for simulator screenshots (the ones in `docs/screenshots/` were taken with them):

| Argument | Does |
| --- | --- |
| `-LodestarTab search\|stays\|plan\|trips\|account` | Opens on that tab |
| `-LodestarDebugEmail a@b.example -LodestarDebugPassword …` | Signs a dev-server test account in at launch |
| `-LodestarTrip <id> -LodestarTripTab flights` | Opens that trip on a tab (`overview`, `itinerary`, `flights`, `hotels`, `book`, `bookings`, `budget`, `checklist`) |
| `-LodestarScrollTo tabs\|<item id>\|<YYYY-MM-DD>` | Scrolls the trip page to the tab bar, an item's card or a day |

Use the sign-in arguments only against a local dev server with a throwaway account.

## Release to TestFlight

```bash
ios/scripts/release.sh              # archive, sign and upload (build number = UTC yyyymmddHHMM)
ios/scripts/release.sh --no-upload  # archive and export ios/build/Lodestar.ipa only
node ios/scripts/asc-builds.mjs     # the latest builds and their processing state
```

The script needs the release Xcode (not a beta), XcodeGen and the 1Password CLI. It reads the Apple Distribution certificate from 1Password into a temporary keychain (deleted on exit) and signs automatically with the App Store Connect API key in `~/.appstoreconnect/private_keys/`. The marketing version comes from `MARKETING_VERSION` in `project.yml`. New builds go to the internal TestFlight group automatically.

## Test

```bash
xcodebuild -project Lodestar.xcodeproj -scheme Lodestar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/lodestar-dd test
```

The tests use Swift Testing and are in `LodestarTests/`, one folder per feature. None of them call the network: models are tested against stubbed `URLProtocol` responses.

## Point at a local server

The default server is `https://lodestar.xanom.co`, set by `LodestarBaseURL` in `Info.plist`. To use the dev server (`npm run dev` in the repo root), launch with an override:

```bash
xcrun simctl launch booted co.xanom.lodestar -apiBaseURL http://localhost:3000
```

In Xcode, add `-apiBaseURL http://localhost:3000` under Scheme > Run > Arguments. The value is stored in the `apiBaseURL` user default, so it stays set until you remove the argument and reinstall, or until you clear that default. App Transport Security allows plain HTTP to local addresses. On a physical device, use your Mac's LAN address instead of `localhost`.

The app sends no `Origin` header, so the server's same-origin check passes without any backend changes.

## Links into the app

The app handles these links (`App/DeepLink.swift`):

| Link | Opens |
| --- | --- |
| `lodestar://reset?token=…` | The "choose a new password" form, with the token filled in |
| `lodestar://t/{token}` | A shared trip page, in Safari View |
| `https://lodestar.xanom.co/reset?token=…` and `/t/{token}` | The same, once universal links are set up |

The emailed reset link is an `https` URL, so it opens the app only after universal links are set up. That needs two changes:

1. The web app serves `/.well-known/apple-app-site-association`, listing `/reset` and `/t/*` for the app ID.
2. The app gets the `com.apple.developer.associated-domains` entitlement with `applinks:lodestar.xanom.co`. This requires a development team.

Until then, users paste the link into Account > "Have a reset link?".

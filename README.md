# Lodestar

**Live: [lodestar.xanom.co](https://lodestar.xanom.co)** · MIT licensed

Flight search that finds lower fares and shows who is selling them. Live prices come from Google Flights. Every search also tries nearby airports, three days either side, and two one-way tickets. An optional account saves your preferences (home airports, alliances, airlines to prefer or avoid, red-eyes, basic economy, cabin and bags) and applies them to every search. Each itinerary can be checked seller by seller, and agencies we haven't vetted are hidden by default. Plan uses your own ChatGPT or Grok subscription to plan several searches at once and pick the best options from the live results. A shortlist can be saved to Trips, which checks its fare daily and emails you when it drops, reaches a target, or on a date you pick. Once you book, mark the fare you bought: Trips then watches that exact fare and tells you when it falls below what you paid and whether its change rules let you get the difference back. Stays searches hotels the same way, with every seller's price including taxes, the same trust tiers, a night earlier or later, and what a refundable rate costs. New accounts get a short paged setup (a question or two per page, connecting AI last) and a tour.

## Run it

You need Node 20+, pnpm and Python 3.11+.

```bash
pnpm install
python3 -m venv fares/.venv
fares/.venv/bin/pip install -r fares/requirements-dev.txt
fares/.venv/bin/playwright install chromium

printf 'LODESTAR_SECRET=%s\nFARES_URL=http://127.0.0.1:8787\n' "$(openssl rand -hex 32)" > .env.local
# Locally the database is PGlite in .data/ and reset links print to the console.

pnpm dev:fares   # fares service on 127.0.0.1:8787
pnpm dev         # web app on localhost:3000
```

## Design

Blackletter: a flat black canvas (light mode by system setting or the theme toggle), Geist Serif for the hero only, Geist for everything else, Geist Mono for codes, and blue (`#4C8DFF`) as the one color. Green, yellow and red appear only as small status dots. Tokens live in `app/globals.css`.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Fares service | `fares/` | FastAPI wrapper around [fli](https://github.com/punitarani/fli), which calls Google Flights' own data endpoints. `/flights` and `/dates` search; `/booking` opens Google's public booking page for one itinerary in headless Chromium and reads the sellers, fare tiers (bags, changes, refunds) and Google's price insight. `/stays/search` and `/stays/prices` read Google Hotels in the same browser (dates and guests go in its `ts` parameter, built in `stays_page.py`): the hotels for a city, then every seller's nightly and total price with taxes and its free-cancellation date. |
| Search | `lib/search.ts` | Adds nearby airports, runs the round trip and the two one-ways in parallel, ranks results (best, cheapest, fastest) and computes the hacks. |
| Hacks | `lib/hacks.ts`, `lib/stopovers.ts` | Applied to every search automatically: nearby airports, shifted dates, two one-ways, a day earlier or later home, driving to a bigger airport 120–300 km away, the next cabin up when it costs little more, booking a group one seat at a time, a round trip that undercuts a one-way, what an overnight flight saves, airline stopover programs (Icelandair, TAP, Iberia, Copa, Turkish, Etihad, Qatar), nonstop for a little more, and no-frills fares. Extra searches run in parallel with a 10-second cap; a card shows only when the saving is real. |
| Seller trust | `lib/sellers.ts`, `lib/verify.ts` | Airline direct, trusted agency (Expedia Group, Booking Holdings, Trip.com Group brands, card travel portals) or not vetted. Not-vetted sellers are hidden unless you ask. |
| Logos | `app/api/logo/*` | Google's airline logos, then Kiwi's (with its placeholder image rejected), then a drawn monogram, so a logo never shows broken. Seller icons come from Google's and DuckDuckGo's icon services; the seller's own site is never contacted. |
| Plan | `lib/ai/canvas.ts`, `app/api/ai/canvas` | The model turns your request into up to five searches, the server runs them on live fares, then the model picks and explains options. It can only cite options by reference, so every price shown is a real search result. |
| Trips and alerts | `lib/trips`, `lib/db/trips.ts`, `app/api/trips`, `app/api/cron/trips` | A saved shortlist keeps its searches, rebuilt and validated on the server. Vercel Cron (`vercel.json`) calls the check once a day: it re-runs each trip that has an alert on and hasn't departed, records the best fare, and emails through Resend on a drop (at least $10 and 3%), a target fare, or a book-by date. Alert emails are capped at 40 a day so password resets keep their share of Resend's allowance. A trip marked booked (`lib/trips/booked.ts`, `app/api/trips/[id]/booking`) stores the exact fare and seller and what was paid; the check then reads that fare from the itinerary's booking page instead of searching, alerts on a drop below the price paid until the booked flight leaves, and says from the fare's change and refund rules whether the difference can come back. |
| Stays | `lib/stays`, `app/api/stays/*`, `components/stays.tsx` | Hotel search over the fares service. Sellers get the same tiers as flights, with the hotel's own site as direct. Each search also re-runs a night earlier and later and flags hotels where that saves at least $20 and 8%; each hotel shows how much more its cheapest refundable rate costs. Prices are for one room. |
| Accounts | `lib/account`, `lib/db`, `app/api/account` | Email and password (scrypt), signed session cookies that a password reset or "sign out everywhere" revokes, reset links by email through Resend. Preferences are one validated JSON row per account in Postgres (Neon in production, PGlite locally). |
| AI sign-in | `lib/ai/session.ts` | ChatGPT or Grok OAuth through `@neelsatyavolu/shared-ai-auth`. Tokens are AES-GCM sealed and bound to their owner. Signed in, they are saved to the account (`ai_connections`) and survive sign-out; signed out, they live in httpOnly cookies scoped to `/api/ai`, bound to an anonymous device id. Signing in moves a browser's connection into the account. |

Booking links open the exact itinerary on Google Flights, where you continue to the seller you picked. Lodestar never sells tickets.

## Deploys

Pushes to `main` deploy automatically:

- The web app deploys through Vercel's GitHub integration.
- The fares service (`fares/`) deploys to Cloudflare Containers through `.github/workflows/deploy-fares.yml` when files under `fares/` change. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Production needs `LODESTAR_SECRET` (signs sessions and seals AI cookies), `DATABASE_URL`, `APP_URL` (used in reset links, alert emails and link previews), `RESEND_API_KEY`, `CRON_SECRET` (Vercel Cron sends it to the daily trip check), `FARES_URL` and `FARES_TOKEN` on the web app, and the same `FARES_TOKEN` as a Worker secret (`wrangler secret put FARES_TOKEN`).

## Tests

```bash
pnpm test             # unit tests (vitest)
pnpm test:coverage
pnpm test:fares       # fares service tests (pytest)
LODESTAR_LIVE=1 pnpm test:fares   # also hits Google Flights live
pnpm smoke            # live AI canvas run; needs both dev servers and a Codex CLI sign-in in ~/.codex/auth.json
pnpm typecheck && pnpm lint
```

In development, `/?welcome` replays the sign-up setup and tour.

## Limits

- Google Flights and Google Hotels have no public API. fli, the booking-page reader and the hotel reader can break when Google changes its pages; pin and update `flights` in `fares/requirements.txt`, and the captured pages in `fares/tests/fixtures` show what the parser expects.
- The date calendar can take 20 seconds or more on Google's side, so the web app loads it separately after the flight results.
- Prices are in USD for a US point of sale.
- The rate limiter is in memory, which is fine for one instance. Use a shared store before running several.
- Hidden-city ticketing is left out on purpose: airlines can cancel the rest of the trip or close the account.

## Credits

- [fli](https://github.com/punitarani/fli) (MIT) for Google Flights search.
- Airport data from [OurAirports](https://ourairports.com/data/) (public domain), rebuilt with `pnpm build:airports`.
- Airline logos are served from Google's and Kiwi.com's public logo images; they belong to their airlines.

## License

[MIT](LICENSE)

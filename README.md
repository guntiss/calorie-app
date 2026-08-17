# Calorie App

A calorie tracker built around **your own foods** rather than a shared database of
questionable entries, where the day's log behaves like a **spreadsheet** — every
amount editable in place, with remaining macros updating as you type.

<p align="center">
  <img src="docs/screenshots/day-grid.png" alt="The day's log: meals, per-row calories, and remaining macros pinned to the footer" width="260">
  <img src="docs/screenshots/log-modal.png" alt="Logging a food: weight, then a search over your whole library" width="260">
</p>

<p align="center">
  <img src="docs/screenshots/food-library.png" alt="My foods: your library, each entry with its per-100g macros" width="260">
  <img src="docs/screenshots/goals.png" alt="Daily goal: calories and macros, entered in grams or percent" width="260">
</p>

## Why this one

Most trackers hand you a search box over a database of millions of entries, most
of them wrong, and ask you to pick. This one starts from the opposite premise:
**you eat perhaps two hundred distinct things**, and once each is entered
correctly, logging is a matter of naming it and putting it on the scale.

- **Two taps and a number.** The plus button, the weight, the food. No screen in
  between, and *Save & next* keeps the dialog up for the rest of the plate.
- **Nothing is ever wrong twice.** A food's macros are yours to fix, and the fix
  holds for every day after — while yesterday's totals stay exactly as logged.
- **The numbers move while you type.** Change 80 g of oats to 60 and the
  remaining-calorie bar answers on the keystroke, not on a save.
- **Built for the phone in a kitchen.** Mobile-first, installable as a PWA, and
  the camera reads a barcode off the packet in your hand.

## What it does

- **Your library is the source of truth.** Foods and recipes are yours, created
  once and reused. No fighting with someone else's wrong data.
- **Logging never blocks on the library.** Anything can be logged by name; it
  joins your library on the way in, and its macros can wait until later.
- **Two taps to log.** A meal's plus button opens one dialog: the weight, then
  the food off a list of your whole library. Nothing lands on the day until both
  are settled, and *Save & next* keeps the dialog up for the next food.
- **Blank macros get a starting point.** Open a food with no calories on it and
  it offers typical per-100g values for a food of that name, from Gemini. They go
  in only when you press *Use*, and are yours to correct from there.
- **Spreadsheet, not forms.** The amount edits inline and the remaining-macro bar
  responds on every keystroke. Macros belong to the food, so the row's edit
  button opens it rather than showing numbers you can nudge by accident.
- **One food per way you weigh it.** A food's macros describe it exactly as it
  goes on the scale; "rice, dry" and "rice, boiled" are two library entries, so
  nothing is ever converted behind your back.
- **Planning mode.** Mark rows as planned to see where the day *would* land, and
  get the warning before you start cooking rather than after.
- **A count toggle per row.** Keep something on the list but out of the total.
- **The packet knows its own name.** Hold the camera over a barcode and the food
  it belongs to is picked, with only the weight left to type. A code nothing
  answers to yet goes onto the food you log next, so scanning the same packet
  tomorrow finds it.
- **Rows go where you put them.** Hold a row to pick it up, then move your finger
  to where it belongs — a line says where it will land, in this meal or another —
  and let go. What gets saved is the order you left it in.
- **Goals in grams or percent.** Two views of one goal. Goals are versioned, so
  changing today's target leaves past days measured against theirs.

Household sharing and photo nutrition-label scanning are the next milestones —
see [Roadmap](#roadmap).

## Stack

Nuxt 4 (Vue 3, SSR) · Postgres 17 · Drizzle ORM · `nuxt-auth-utils` with Google
OAuth · Nuxt UI + Tailwind v4 · Pinia · ZXing via `barcode-detector` for barcodes
· deployed with docker compose behind Caddy.

## Getting started

Requires Node 22+, pnpm, and Docker.

```bash
pnpm install
cp .env.example .env          # then fill in the values below
docker compose up -d db       # Postgres on localhost:5432
pnpm dev                      # migrations run automatically at boot
```

`.env` needs at minimum:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | `postgres://calorie:calorie@localhost:5432/calorie` for local work |
| `NUXT_SESSION_PASSWORD` | 32+ characters — `openssl rand -base64 32` |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID` / `_SECRET` | from the Google Cloud console |
| `NUXT_GEMINI_API_KEY` | optional — suggested macros for blank foods; without it the dialog simply offers none |
| `NUXT_GEMINI_MODEL` | optional — defaults to `gemini-3.5-flash-lite`, which answers this prompt in under a second; a slower model will not fit the 8s timeout |

In development you can skip Google entirely and visit **`/auth/dev`**, which signs
you in as a local account. That route 404s outside dev mode.

The Google authorised redirect URI must be exactly `https://<your-domain>/auth/google`.

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Dev server; applies pending migrations at boot |
| `pnpm test` | Vitest — the nutrition math |
| `pnpm test:e2e` | Playwright — mobile-viewport end-to-end path |
| `pnpm typecheck` | `vue-tsc` across app, server and shared |
| `pnpm db:generate` | Generate a migration after editing the schema |
| `pnpm build` | Production build into `.output` |

## How it fits together

**`shared/utils/nutrition.ts`** holds every calculation and is auto-imported into
both the client and the server. The grid recomputes totals with it on each
keystroke and the server recomputes with it before writing, so what you see while
typing is exactly what gets stored. It is pure, dependency-free, and the most
heavily tested part of the codebase.

**Foods and recipes share one table.** A recipe is a food with `kind='recipe'`
plus rows in `recipe_components`, its macros derived from those components and
cached. Everything loggable is therefore just a food id.

**Log entries carry a resolved macro snapshot.** That one choice covers two
requirements at once: a row can exist with no macros yet, and editing a food
tomorrow never rewrites yesterday's totals.

**`PUT /api/log/:date` is a batch reconcile.** The grid collects dirty rows and
flushes them together in one transaction. Row ids are generated on the client, so
an optimistic row and its saved counterpart are the same record.

**Suggested macros never write anything.** `POST /api/foods/suggest` asks Gemini
for typical per-100g values and answers `{ known: false }` for a name it cannot
place; the dialog offers what comes back and the food is only touched when the
user accepts it and saves. A deployment with no key just returns 503, which the
dialog reads as "nothing on offer".

**Gemini is asked each question once.** Every request and its answer land in
`gemini_cache`, keyed by a hash of the whole request — model, instructions,
question, answer shape — so the second person to open the same blank food is
served from Postgres rather than billed. A question the model had no usable
answer to is cached too, as a null response, since those are otherwise the ones
paid for over and over; those entries lapse after a week, in case the blank was a
passing refusal. Nothing that failed on the way out — a timeout, a rate limit —
is ever cached.

**A lookup fails fast or not at all.** Someone is watching a spinner, so the
request is never retried and is abandoned after 8s. A rate limit is taken at its
word: Google says when to come back, and until then no request is sent at all —
the dialog is told there is nothing on offer in a few milliseconds rather than a
few hundred. Cached answers are still served throughout.

**A barcode is not one number.** The same packet is a 12-digit UPC-A in one
scanner and a 13-digit EAN-13 in the next — the same digits with a zero in
front — and a small packet carries the squeezed-up UPC-E form of those twelve.
So a code is stored exactly as it was read and every lookup asks about all of
its forms; `shared/utils/barcode.ts` is that conversion and nothing else. The
column is deliberately not unique: a shop's own label is reused across a range,
and a code typed in wrong is a correction to make rather than a save to refuse.

**The camera uses the browser's own reader where there is one.** Chrome has
`BarcodeDetector` built in; Safari does not, which is the phone this is actually
used on, so a WebAssembly reader is fetched in its place — the first time
someone opens the scanner, not by everyone who opens the app. Its `.wasm` is
served by this deployment rather than the CDN the library defaults to, so
scanning does not quietly depend on jsdelivr being reachable from a kitchen.

**Dates are plain `YYYY-MM-DD` strings resolved in the user's timezone.** The
server never decides what "today" is — a 3am dinner belongs to the day you'd say
it does.

## Deployment

On the server, with `.env` filled in including `SITE_DOMAIN` and `SITE_URL`:

```bash
docker compose up -d --build
```

That runs Postgres, the app, and Caddy, which obtains TLS certificates for
`SITE_DOMAIN` automatically. Migrations apply when the app container starts, so
deploying and migrating are the same action.

`.github/workflows/ci.yml` runs typecheck, unit tests and the Playwright path
against a Postgres service container on every push and pull request. Deployment
is deliberately not part of this repository: it is specific to one server, and a
workflow naming somebody else's runner is of no use to anyone cloning this.

## Roadmap

- **M1 — Foundation and manual logging.** ✅ Auth, food library, spreadsheet day
  grid, goals, count toggle, planning warnings, docker deployment.
- **M2 — Recipes and planning.** Recipe builder, portion solver ("fit this to my
  remaining calories"), copy a previous day.
- **M3 — Household sharing.** Shared library via invite codes, browse a member's
  day, one-tap copy into your own log.
- **M4 — Scanning.** Barcode lookup ✅. Next: photograph a nutrition label,
  Claude vision returns structured macros, you confirm before it saves.
- **M5 — Polish.** Offline PWA queue, desktop keyboard navigation, trends, export.

## License

MIT — see [LICENSE](LICENSE).

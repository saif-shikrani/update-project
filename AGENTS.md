# AGENTS.md — Telnyx + Baileys Desk

Handoff doc for any coding agent (Copilot, Claude, Cursor, Codex…) working on this repo.
Read this before touching code. Product spec lives in `prd.md`.

Last updated: 2026-11-15

---

## 1. What this app is

A **local web console** ("Desk") for voice + WhatsApp, on one Node process with a SQLite file.

- People sign up / sign in. First account becomes `admin`, everyone after is `user`.
- Users buy Telnyx phone numbers and place browser calls (Telnyx WebRTC) against a prepaid balance.
- Credit requests are approved/rejected by an admin; approval writes to the ledger.
- **One** WhatsApp account is linked via Baileys (admin only). Inbound texts are stored, each
  chat has a summary (Gemini) and optional auto-reply trained on the admin's own replies.

Stack: **Node 22 + Fastify 5 + `node:sqlite`** (no ORM) · **React 19 + Vite 7**, plain CSS.
No Tailwind, no router library (hash routing), no test runner beyond `node:test`.

---

## 2. Run it

```bash
npm install                # if lockfile is fresh; baileys is a git dep
npm run dev                # tsx src/dev.ts → API (tsx watch) + Vite together
```

| Thing | Value |
|---|---|
| Web UI | http://127.0.0.1:5173 |
| API | http://127.0.0.1:8787 (Vite proxies `/api` here) |
| Production-ish | `npm run build` then `npm start` (Fastify serves `web/dist`) |
| Tests | `npm test` (`src/server/logic.test.ts`) |

`npm run dev` = `tsx src/dev.ts`, which spawns two children: `tsx watch src/server/index.ts`
and `vite`. If ports 5173/8787 are busy it fails (`strictPort: true` on Vite).

Logs during dev: server logs JSON (pino) to the terminal, i.e. wherever `npm run dev` was started.

### Env

`.env` (gitignored, loaded by `src/server/env.ts` — not dotenv):

```
TELNYX_API_KEY, TELNYX_PUBLIC_KEY, TELNYX_CONNECTION_ID, TELNYX_PHONE_NUMBER
TELNYX_TELEPHONY_CREDENTIAL_ID   # optional; auto-created if blank
GEMINI_API_KEY, GEMINI_MODEL     # default gemini-3.6-flash
PORT=8787
```

All currently set. `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` also exist in `.env` but **nothing reads
them** — dead config, safe to ignore or delete.

### Accounts present in `data/app.db`

| id | email | role | notes |
|---|---|---|---|
| 1 | tahir@desk.com | admin | original first account |
| 2 | herexumii@gmail.com | admin | |
| 3 | ahmadsiddique@gmail.com | admin | **primary dev/test login**, password `ahmad123` |

(Password is stored as `salt:hash` scrypt — see `src/server/auth.ts`. Never log or dump it.)

---

## 3. Repo map

```
src/
  dev.ts                  dev runner: spawns API watch + Vite
  server/
    index.ts              Fastify app, all routes, static file serving, auth gate
    auth.ts               signup/login/logout, scrypt hashing, `desk_session` cookie
    db.ts                 schema + every SQL statement (calls, users, wa_*, ledger…)
    logic.ts              pure helpers: units, durations, cost parsing, prompt pairing
    accounts.ts           balance, dashboard, number purchase, credit requests
    telnyx.ts             token minting, webhook verify/apply, cost refresh, number search
    whatsapp.ts           Baileys lifecycle, QR/status SSE, ingest, auto-reply scheduling
    reply.ts              learned reply pattern + draft generation
    gemini.ts             Gemini generateContent wrapper
    env.ts                .env loader + `required()`
    logic.test.ts         unit tests for logic.ts
web/
  index.html              title/meta/theme-color
  public/favicon.svg      brand mark
  src/
    main.tsx              React root + font imports
    App.tsx               shell (sidebar, mobile sheet), nav, Calls screen, WhatsApp screen
    desk.tsx              AuthScreen, Dashboard, NumbersPage, BillingPage, AdminPage
    ui.tsx                Icon set, Brand, Chip, Notice, PageHead, EmptyState, skeletons
    styles.css            the whole design system (single file)
    phone.ts              Telnyx WebRTC wrapper (placeCall / hangUp / onCallUpdate)
data/
  app.db                  SQLite (gitignored)
  baileys-auth/           WhatsApp session (gitignored) — do NOT delete without asking
.agents/skills/design-taste-frontend/   installed design skill (see §6)
skills-lock.json          skill lockfile
prd.md                    product spec (source of truth for behaviour)
```

---

## 4. Backend contract (things easy to break)

**Auth gate** — `onRequest` hook in `index.ts` protects everything under `/api/`, except:
`/api/health`, `/api/telnyx/webhook`, `/api/auth/*`. WhatsApp routes additionally require
`role === 'admin'` (403 otherwise).

**Money is integer units.** `$1 = 10,000 units` (`toUnits` / `fromUnits` / `priceUnits` in
`logic.ts`). DB stores `balance_units INTEGER`, `ledger.amount_units INTEGER`. Display divides by
10000. Never introduce floats into balance math.

**Call cost is pending until Telnyx prices it.** `calls.cost_amount IS NULL` + `status='hangup'`
= pending (`pendingCostCount`). Charging happens once via `calls.charged` inside
`setCallCost()` (transaction: balance -= units, ledger row, charged = 1).

**Webhook signature** needs the *raw* body — that's why `index.ts` installs a custom
`application/json` parser that keeps `{ raw, json }`. Don't "simplify" it away.

**Routes** (all JSON, errors `{ error }` with status code):

```
GET  /api/health
POST /api/auth/signup | login | logout        GET /api/auth/me
GET  /api/dashboard
GET  /api/numbers/available?country&area&contains
GET  /api/numbers            POST /api/numbers/order
GET  /api/billing/requests   POST /api/billing/requests
POST /api/billing/requests/:id/approve | reject
POST /api/telephony/token    (GET legacy alias)
GET  /api/calls              GET /api/calls/:id
POST /api/calls/:id/refresh-cost    POST /api/calls/sync
POST /api/telnyx/webhook      (signature-verified, no session)
GET  /api/whatsapp/status | /events (SSE) | /chats | /reply
POST /api/whatsapp/reply
GET  /api/whatsapp/chats/:jid/messages
POST /api/whatsapp/chats/:jid/summary      (Gemini)
```

**Schema changes**: `db.ts` runs `CREATE TABLE IF NOT EXISTS` plus manual `ALTER TABLE … ADD COLUMN`
guards (`PRAGMA table_info`). Follow that pattern — no migration framework, and existing dev DBs
must keep working.

---

## 5. Frontend contract

- **Hash routing**, no library: `#/`, `#/calls`, `#/numbers`, `#/billing`, `#/admin`, `#/whatsapp`.
  `useHash()` in `App.tsx`. Non-admins hitting `#/admin` / `#/whatsapp` are redirected to `#/`.
- **All API calls are `fetch` + `readJson<T>()`** (throws on `!response.ok`). No react-query/SWR.
- **`ui.tsx` owns presentation primitives.** Add icons to the `IconName` union *and* the `paths`
  object, or TypeScript fails (this already bit us once with `whatsapp`).
- **The WhatsApp icon must be the user-supplied Tabler SVG** (`whatsapp` key in `ui.tsx`,
  two `<path>`s — bubble + handset). Do not swap it for a filled logo.
- Screens are composed from `PageHead` + `.panel` sections; keep that shape.

### Design system (do not casually break)

Tokens live in `:root` in `styles.css`:

| token | value | use |
|---|---|---|
| `--paper` | `#f4f3ee` | warm bone page ground |
| `--surface` | `#fffefb` | panels/cards |
| `--ink` | `#191b17` | text |
| `--ink-panel` | `#151713` | sidebar + auth aside + balance card |
| `--accent` | `#15664a` | the one accent (primary buttons, links, focus) |
| `--line` | `#e5e3da` | hairlines |

Rules that keep it coherent:

1. **One accent.** Emerald `--accent` only. No second brand colour, no gradients except the
   subtle radial in the balance card / auth aside.
2. **Two fonts**: `Instrument Sans Variable` (UI), `JetBrains Mono Variable` (numbers, phone
   numbers, code). Imported in `main.tsx` from `@fontsource-variable/*`.
3. **One radius family** (`--r-sm/md/lg/btn`), one button shape, one card recipe (`.panel`).
4. **Type scale**: 16px body, 13px labels/chips/th, `h1` uses `clamp()`.
5. **Chip capitalisation is done in JS** with `cap()` in `desk.tsx` — *not* CSS
   `text-transform` (that mangled text earlier).
6. **`.page { overflow-x: clip; }` is load-bearing.** It stops the wide Calls table from creating
   a horizontal scrollbar at 1024px. Removing it re-breaks the layout.
7. **Tables → cards at ≤820px** via `td::before { content: attr(data-label) }`. Every `<td>` in
   table markup needs a `data-label`.
8. Touch targets stay ≥44px; focus ring `2px solid var(--accent)`; `prefers-reduced-motion`
   block at the bottom must keep covering new animations.

---

## 6. Design skill

`npx skills add Leonxlnx/taste-skill` installed **`design-taste-frontend`** (v2.5.1) at
`.agents/skills/design-taste-frontend/` (lockfile: `skills-lock.json`).
Its `SKILL.md` + `references/` (layout-v4, system, motion, copy, backgrounds…) are the styling
authority for further UI work. Load it before a redesign; its `references/gate.md` is the
self-check list.

---

## 7. Where we are (state as of 2026-11-15)

### Done

- **Full UI/UX redesign shipped** — every screen rewritten against the design system above.
  New files: `web/src/ui.tsx`. Rewritten: `App.tsx`, `desk.tsx`, `styles.css`, `main.tsx`,
  `index.html`, `public/favicon.svg`.
- Dark sidebar shell + full-screen mobile menu sheet (Esc closes, focus moves into the sheet,
  body scroll locked).
- Auth screen: split layout (dark marketing panel + form), animated Sign in / Create account tabs,
  password show/hide, `#/signup` deep link.
- Dashboard: dark balance card, destination table, ledger with in/out colouring, skeletons.
- Calls: dialer with live pulse state, call history table with per-row "Refresh cost".
- Numbers: inventory search + owned list + buy grid with balance guard.
- Billing: request form + 3-step explainer + request history.
- Admin: pending approvals with approve/reject, decided list.
- WhatsApp: connection + QR panel, auto-reply switch, chats column, transcript, summary box.
- WhatsApp icon replaced with the Tabler outline SVG the user supplied.
- `npx tsc --noEmit` clean, `npm run build` clean.
- Responsive verified in headless Chrome at 1440 / 1024 / 768 / 390 / 320 — no horizontal
  overflow on any route.

### Uncommitted

`git status`: modified `package.json`, `package-lock.json` (fonts + `allowScripts`), `web/index.html`,
`web/public/favicon.svg`, `web/src/{App,desk,main}.tsx`, `web/src/styles.css`; new `web/src/ui.tsx`.
Last commit is `7772878 added taste skill for design`. **Nothing is committed yet — decide with
the user before committing.**

### Known issue (needs the human, not code)

WhatsApp bridge is logged out:

```json
{"connection":"close","error":"WhatsApp logged this device out. Delete data/baileys-auth and restart to link again."}
```

To relink: stop the dev server, `rm -rf data/baileys-auth`, `npm run dev`, open `#/whatsapp`,
scan the QR from the phone. **Do not delete `data/baileys-auth` on your own initiative** — it is
the user's session; ask first.

### Nice-to-haves nobody has asked for yet

- No dark theme; `color-scheme` is pinned light.
- No pagination anywhere (calls capped at 200, ledger/chats unpaged).
- `web/dist` is stale unless you run `npm run build`; `npm start` serves it.

---

## 8. How to verify a change (do this every time)

```bash
npx tsc --noEmit      # must be silent
npm run build         # must succeed
npm test              # logic tests
```

Then look at it in a real browser. No Playwright/Puppeteer is installed; the workflow used here is
Chrome DevTools Protocol with `google-chrome-stable --headless=new --remote-debugging-port=…`
plus `Page.captureScreenshot` / `Emulation.setDeviceMetricsOverride`. Existing helpers live in
`/tmp/opencode/` (temporary — regenerate if gone):

- `cdp-shots2.mjs` — logs in via `fetch('/api/auth/login')`, screenshots every route at several
  widths and scans `document.documentElement.scrollWidth > innerWidth` for overflow.
- `cdp-final.mjs`, `debug*.mjs` — smaller probes.

Login for automation: POST `/api/auth/login` with `{email:"ahmadsiddique@gmail.com",password:"ahmad123"}`,
then `Page.reload` so the React state picks up the cookie.

Check at **1440, 1024, 768, 390 and 320** widths, and check `#/`, `#/calls`, `#/numbers`,
`#/billing`, `#/admin`, `#/whatsapp`.

---

## 9. House rules for agents

- Match the existing style: no new dependencies unless necessary, no state library, no CSS
  framework, no router.
- Keep data/API logic untouched when only the UI changes — the redesign preserved every fetch.
- Don't reformat whole files; make surgical edits.
- Don't commit, push, or delete user data (`.env`, `data/*`) without explicit permission.
- Comments are rare and plain in this codebase; keep it that way.
- Write user-facing copy in plain language, sentence case, no marketing fluff (see
  `.agents/skills/design-taste-frontend/references/copy*.md`).

# Copilot instructions

Full context lives in **[`AGENTS.md`](../AGENTS.md)** at the repo root — read it first.
This file is the short version.

## Project

Local voice + WhatsApp console: Node 22 / Fastify 5 / `node:sqlite` API in `src/server/`,
React 19 + Vite front end in `web/`. No ORM, no router library, no CSS framework, no state library.

## Commands

```bash
npm run dev      # API :8787 + Vite :5173
npm run build    # vite build → web/dist
npm test         # node:test for src/server/logic.ts
npx tsc --noEmit # must stay silent
```

## Non-negotiables

- **Money is integer units, `$1 = 10,000`.** Use `toUnits` / `fromUnits` / `priceUnits` from
  `src/server/logic.ts`. Never use floats for balance or ledger amounts.
- **Auth**: `desk_session` cookie; the `onRequest` hook in `src/server/index.ts` gates all
  `/api/*` except health, Telnyx webhook and `/api/auth/*`. WhatsApp routes are admin-only.
- **Keep the raw body parser** for `application/json` — Telnyx webhook signatures need the
  unparsed payload.
- **Schema changes** go in `src/server/db.ts` as `CREATE TABLE IF NOT EXISTS` plus the existing
  `PRAGMA table_info` + `ALTER TABLE` guard pattern.
- **UI primitives** live in `web/src/ui.tsx`. A new icon needs both the `IconName` union member
  and an entry in `paths`, or TypeScript fails.
- The WhatsApp icon is the Tabler outline SVG supplied by the user (`whatsapp` in `ui.tsx`).
  Do not replace it.
- `.page { overflow-x: clip }` in `web/src/styles.css` prevents a 1024px horizontal scrollbar.
  Don't remove it.
- Every `<td>` in a table needs `data-label` — tables collapse into cards below 820px.
- Chip capitalisation happens in JS via `cap()` in `web/src/desk.tsx`, not CSS.

## Design system

Warm bone ground `#f4f3ee`, panels `#fffefb`, ink `#191b17`, dark panel `#151713`, **one** accent
`#15664a`. Fonts: Instrument Sans (UI) + JetBrains Mono (numbers). One radius family, one button
shape, one `.panel` card recipe, 16px body / 13px labels. Details and the reference files are in
`.agents/skills/design-taste-frontend/`.

## Workflow

Surgical edits only; no new dependencies without need; don't commit, push, or delete `.env` /
`data/*` without asking. Verify with `npx tsc --noEmit`, `npm run build`, and a visual check at
1440 / 1024 / 768 / 390 / 320 on `#/`, `#/calls`, `#/numbers`, `#/billing`, `#/admin`,
`#/whatsapp`.

# Spec: OrderPilot — Chrome extension order agent (Amazon.in · Flipkart · JioMart)

## Assumptions
1. Chrome desktop (MV3) only, on one Windows PC; Chrome must be open for the daily sweep.
2. You are already logged in to each shopping account in Chrome; the extension never types passwords or OTPs.
3. One coupon code per Cart Builder run, one product link per run (a multi-product cart comes later).
4. Prices are in INR; the target cart value is compared with the cart **subtotal before the coupon discount** (this is how minimum-cart-value coupons work).
5. Supabase: a **new** project, signed in with your own email login; the extension works offline/local-only until you sign in.
6. Daily sweep at 09:00 local time by default (configurable), plus "Run sweep now".
7. The Claude fallback is off until an API key is entered in Settings.

## Capability map
| Module id | Responsibility | Depends on |
|---|---|---|
| scaffold | WXT/React/Tailwind side panel, theme, Dexie schema, settings, job runner shell | — |
| amazon-cart | Amazon product read, qty math, add to cart, cart read, coupon at checkout, stop before pay | scaffold |
| amazon-orders | Order capture, Your Orders reconciliation, detail and tracking, status history, daily alarm, notifications | amazon-cart |
| amazon-invoices | Invoice fetch, SHA-256 dedup, per-date/per-account ZIP | amazon-orders |
| claude-fallback | Selector→Claude structured extraction with PII masking | scaffold |
| flipkart | Flipkart adapter for all flows | amazon-invoices, claude-fallback |
| jiomart | JioMart adapter for all flows | amazon-invoices, claude-fallback |
| supabase-sync | Postgres schema, RLS, outbox sync, Storage for PDFs | amazon-orders |
| polish | Excel export, filters, error centre, onboarding | all |

Build order: scaffold → amazon-cart → amazon-orders → amazon-invoices → claude-fallback → flipkart → jiomart → supabase-sync → polish

## Objective / user stories
- **US1 Cart Builder:** Given a product link, coupon and target value (qty optional), the extension sets the quantity to the smallest qty with subtotal ≥ target (clamped to the site max), applies the coupon, and leaves me on the cart/payment page. It never clicks Pay or Place Order.
- **US2 Capture:** After I pay, the order and its full details are stored under the account that is logged in, within 1 minute (confirmation page) or at the next reconciliation.
- **US3 Daily status:** Every day, each open order's status is checked; changes go into `status_events`; a full `daily_snapshots` row is saved per order per day; tracking stops at Delivered/Cancelled/Returned; I get a notification summary.
- **US4 Invoices:** Available invoices are fetched once, deduplicated by key and hash, and zipped per date and account; re-running never re-downloads.
- **US5 UI:** A clean side panel with Cart Builder, Orders (with timeline), Daily Log, Invoices and Settings, in light and dark mode.

## Speed and layered execution (approved 2026-10-09)
- No human-speed delays. Requests run in parallel per site (default 6, range 1–12). Adaptive backoff applies only on 429/503, CAPTCHA or timeout.
- Every fetch runs a ladder:
  - **A**: direct HTTP plus offscreen DOMParser, or the site's JSON API
  - **B**: same-origin fetch inside a content script
  - **C**: hidden tab render
  - **D**: Claude extraction
  - **E**: report the gap
- Every action runs a ladder:
  - **A**: direct URL/API
  - **B**: CSS selector list
  - **C**: semantic text/ARIA match with full pointer events
  - **D**: Claude picks the element
  - **E**: hand to you
- Each step is validated by a schema or a post-condition. A failure moves to the next layer.
- The winning layer is remembered per site and operation.
- A payment guard in the action engine blocks Pay/Place-order at every layer.
- Completeness: required-field schemas; orders with missing fields are flagged and retried, never dropped.

## Tech stack
WXT 0.21 (MV3) · TypeScript 5 · React 18.3 · Tailwind 3.4 (hand-built components in a shadcn style; no shadcn CLI) · Dexie 4 · zod 4 · JSZip 3.10 · @supabase/supabase-js 2 · Vitest + jsdom · Playwright 1.4x. Exact versions are pinned in `package.json` when the scaffold is built.

## Commands
```
npm install
npm run dev          # WXT dev: opens Chrome with the extension and hot reload
npm run build        # production build → .output/chrome-mv3
npm run zip          # packaged zip for loading/sharing
npm test             # vitest run (unit + fixture parsers)
npm run test:watch
npm run e2e          # playwright, extension loaded against tests/fixtures served locally
npm run lint         # eslint + tsc --noEmit
```

## Project structure
```
entrypoints/background.ts              job runner, alarms, notifications, downloads
entrypoints/sidepanel/                 React app (pages: CartBuilder, Orders, OrderTimeline, DailyLog, Invoices, Settings)
entrypoints/<site>.content.ts          per-site content script → adapter
src/adapters/<site>/{selectors,adapter}.ts
src/core/{qty,status,extract,dedupe,zip,blocker,messaging}.ts
src/db/{schema,dexie,sync}.ts
src/llm/{claude,mask}.ts
supabase/migrations/001_init.sql
tests/unit/  tests/fixtures/<site>/*.html  tests/e2e/
```

## Code style
TypeScript strict; pure functions in `src/core` (no `chrome.*`, so they are unit-testable); adapters return typed results or `null`, never guessed values.
```ts
// src/core/qty.ts
export function qtyForTarget(unitPrice: number, target: number, maxQty: number) {
  if (!(unitPrice > 0)) return { qty: null, reason: 'no-price' } as const;
  const needed = Math.ceil(target / unitPrice);
  const qty = Math.min(Math.max(needed, 1), maxQty);
  return { qty, subtotal: qty * unitPrice, shortfall: Math.max(0, target - qty * unitPrice) } as const;
}
```
Naming: camelCase functions, PascalCase components/types, kebab-case files except React components.

## Testing strategy
- **Unit (Vitest):** qty math, status normalisation, dedupe, ZIP naming, PII masking. Written test-first.
- **Fixture parsers (Vitest + jsdom):** saved, anonymised real HTML per site and page type; assertions field by field.
- **E2E (Playwright, extension loaded):** cart flow against fixtures; assert that no element matching Place Order/Pay is ever clicked; simulate the alarm; assert a ZIP is created once.
- **Live smoke:** manual, per site, with a cheap item (checklist in `tasks/todo.md`).

## Boundaries
- **Always:** stop before payment; pause on CAPTCHA/OTP/login and notify; adaptive backoff when a site pushes back; mask PII before any Claude call; run `npm test` and `npm run lint` before each commit.
- **Ask first:** adding dependencies beyond the stack above; Supabase schema changes after M7; widening `host_permissions`; any change to the stop-before-payment rule.
- **Never:** click Pay/Place Order; solve or bypass CAPTCHA/OTP; store passwords; put keys in `chrome.storage.sync` or in source; commit real order HTML without anonymising it.

## Success criteria
1. Cart Builder reaches subtotal ≥ target with the minimum qty on all three sites, and reports the coupon result and the payable amount.
2. 100% of orders placed while the extension is installed appear in Orders by the next sweep.
3. Every open order gets exactly one `daily_snapshots` row per day the sweep runs; a status change creates exactly one `status_events` row.
4. Running the invoice job twice in a day produces zero additional downloads.
5. The e2e suite proves no payment button is ever clicked.
6. The side panel renders correctly in light and dark mode at 360–480 px width.

## Open questions
1. Daily sweep time: is 09:00 OK? Add a second (evening) sweep for orders that are Out for delivery?
2. Should a Cart Builder run accept **several product links** in one cart (sharing one coupon/target), or is one product per run enough for v1?
3. New Supabase project (assumed), or reuse an existing one?
4. Invoice ZIP download location: `Downloads/OrderPilot/Invoices/<account>/` OK?

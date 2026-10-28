# OrderPilot — Task list

Plan: `SPEC.md`.
Verify everything with: `npm test` (77 unit/fixture tests), `npm run compile`, `npm run e2e` (14 end-to-end checks).

## M0 scaffold: done
- [x] T0.1 WXT + React + Tailwind project, MV3 manifest, side panel, offscreen page, icons
- [x] T0.2 Dexie schema (orders, statusEvents, dailySnapshots, invoices + blobs, cartRuns, ladderStats, errors, outbox)
- [x] T0.3 Side panel: Cart, Orders (+ timeline), Daily log (CSV export), Invoices, Settings; light/dark

## M0.5 engine: done (test-first)
- [x] T0.4 `ladder.ts`: ordered layers, timeouts, validation, sticky winner, daily retry from A, BlockedError stops
- [x] T0.5 `pool.ts`: per-site concurrency, halve on 429/503/captcha, exponential backoff, ramp after 10 clean results
- [x] T0.6 `actions.ts`: selector → semantic click with pointer events, React-safe input setter, post-conditions, **payment guard**
- [x] T0.7 `schemas.ts`: required fields and completeness score
- [x] T0.8 `qty.ts`, `status.ts`, `dedupe.ts`, `zip.ts`, `mask.ts`

## M1 amazon-cart: done (e2e on a simulated site)
- [x] T1.1 Amazon selectors and parsers with fixture tests
- [x] T1.2 Cart job:
  - add: form POST → cart-add URL → button → Claude → you
  - quantity
  - target check
  - checkout
  - coupon
  - stop
- [x] T1.3 Cart Builder UI with a live step log showing the winning layer
- [ ] T1.4 **Live smoke test on amazon.in with a cheap item (you)**; save real pages for tuning

## M2 amazon-orders: done (e2e on a simulated site)
- [x] T2.1 Confirmation-page capture; Your Orders discovery across all pages, with a text fallback
- [x] T2.2 Order detail and tracking reads through ladder A/B/C/D
- [x] T2.3 Daily sweep:
  - 09:00 alarm, optional evening alarm, catch-up on startup
  - parallel refresh
  - status events only on change
  - one snapshot per day
  - incomplete orders retried
- [x] T2.4 Orders tab and timeline UI
- [ ] T2.5 Tune selectors on real saved pages (needs T1.4)

## M3 amazon-invoices: done (e2e on a simulated site)
- [x] T3.1 Invoice discovery and fetch (A worker fetch → B site-tab fetch), dedupe by key and SHA-256
- [x] T3.2 Daily ZIP per account and date, mark zipped, re-zip a date range; Invoices tab

## Code review (agent-skills code-reviewer), 2026-10-09: fixed
- [x] Payment guard:
  - reads aria-labelledby, labels and interactive ancestors
  - checkout pages allow only coupon controls
  - the Claude click re-checks the element label
- [x] `read()` never rejects; a CAPTCHA pauses and notifies instead of retrying; the sweep uses allSettled
- [x] Pool: created once per site; cooldown starts before the slot is freed; queued tasks wait it out
- [x] Worker tabs: one shared window, no leaked slots, dead tabs dropped, generation counter
- [x] Invoices:
  - same lock as manual runs
  - ZIP rows claimed before download
  - failures logged and retried
  - "done" only when every invoice is stored
- [x] Discovery: an empty page after "Next" is logged as a failure; every order gets at least one full read
- [x] Cart:
  - layers re-read the cart before adding (no double add)
  - quantity raise fixed and capped at the per-order max
  - the stepper is bounded
- [x] Ladder: winner moved to the front only; Claude (D) and the user (E) are never remembered as the start
- [x] Worker keep-alive during jobs, plus a 30-minute catch-up alarm for a sweep that never finished
- [x] Masking: names and the whole address block (city and pincode kept)
- [ ] Open: an account with zero orders makes the first list page fall through to Claude every day; add an "empty list" marker

## M4 claude-fallback: partly done
- [x] Extraction (`claudeExtract`) and element picking (`claudePickElement`) with PII masking; key in Settings
- [ ] Live check with your API key: break a selector in a fixture, confirm the schema-valid result

## M6 jiomart: done (verified against a real logged-in account, read-only, 2026-10-09)
- [x] Research: JioMart now runs on the Fynd platform. The API needs the `/api/service/application/...` prefix plus the public app header and the session cookie; invoices come through `/ext/hellcat/details/<shipment>/` (token) and `/ext/hellcat/shipment/invoice/?invoice_url=<token>` (PDF); price is in `.PriceContainer__currentPrice`.
- [x] Parsers:
  - pages: product, cart, coupon, order-status, order list, shipment
  - API: session, orders, order, shipment, cart
  - fixtures mirror the verified structure, with synthetic values
- [x] Cart flow:
  - quantity: cart API `update_item` → product +/− → cart +/− → Claude → you
  - coupon: cart API → coupon drawer → you
  - stops on `/cart/bag`
- [x] Daily check: one orders-API call saves 20 full orders; open orders refreshed from the shipment endpoint
- [x] Invoices via the shipment token; same once-only rule and ZIPs; order capture on `/cart/order-status`
- [x] e2e: `tests/e2e/jiomart-smoke.mjs` (13 checks)
- [ ] Live check (you): run Cart Builder on a cheap JioMart item, then "Check status now"
- [ ] Coupon drawer selectors unverified (your cart had no in-stock item); the API path is primary

## M5 flipkart
- [ ] Flipkart adapter (selectors, parsers, actions, fixtures); coupon at checkout

## M7 supabase-sync · M8 polish
- [ ] Supabase migrations + RLS, outbox flush, invoice Storage bucket
- [ ] Excel export, onboarding, `/review` + `/ship`

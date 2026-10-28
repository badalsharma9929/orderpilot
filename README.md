# OrderPilot

A Chrome extension for repeat orders on Amazon.in and JioMart, with Flipkart planned:

- **Cart Builder.** Give it a product link, a target cart value and an optional coupon. It adds the smallest quantity that reaches the target and applies the coupon. It **stops on the payment page; you pay yourself.**
- **Order capture.** When you pay, the order is saved under the account that is signed in.
- **Daily status check.** Every order is read until it is delivered, cancelled or returned: status, courier, AWB, ETA and scan events. One full snapshot is saved per order per day.
- **GST invoice (JioMart).** Set your GSTIN in Settings; the cart's *GST Invoice* box is filled in for you.
- **Excel report.** After each check, `Downloads/OrderPilot/Reports/OrderPilot_orders_<date>.xlsx` with sheets Orders, Items, Tracking, Status history, Invoices and Daily log. There is also an **Export Excel** button in Orders.
- **Invoices.** Each invoice PDF is downloaded once, never twice. Duplicates are caught by invoice number and by file hash. The day's new invoices are zipped per account and date.

## Install (unpacked)

```bash
npm install
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `.output/chrome-mv3`.
3. Pin OrderPilot, then click its icon to open the side panel.

For development with hot reload, run `npm run dev`. It opens Chrome with the extension loaded.

## How every step stays fast and survives layout changes

Every read and every click runs as a ladder of layers, fastest first. A layer counts only when its result validates: for a read, the required fields are present; for a click, the cart, quantity or coupon actually changed.

| Layer | Reading pages | Clicking / actions |
|---|---|---|
| A | Direct HTTP with your session, parsed off-screen; no tab opened | Direct URL/API (form POST, cart-add URL) |
| B | Fetch from inside an open site tab | CSS selector list |
| C | Render in a hidden minimised tab | Visible-text / ARIA match with full pointer events |
| D | Claude reads the PII-masked page text | Claude picks the control (never a payment control) |
| E | Logged under *Needs attention* and retried on the next check | A banner asks you to do that step; the run then continues |

The winning layer is remembered for each site and step, so later runs start there. The full order is retried once a day.

Requests run in parallel, 6 per site by default. A site is slowed down only when it pushes back (HTTP 429/503, a CAPTCHA, a timeout). CAPTCHAs and OTPs are never bypassed: OrderPilot pauses and asks you.

## Commands

```bash
npm test
```

Runs the unit and fixture-parser tests (Vitest).

```bash
npm run e2e
```

Builds, then runs the real extension in Chromium against a simulated amazon.in.

```bash
npm run compile
```

Type-checks the project.

## Tuning to your real pages

The parsers were written against synthetic copies of Amazon pages. To tune them to your real pages:

1. Open an order or tracking page.
2. Go to **Settings → Save this page for tuning**. The page is saved to `Downloads/OrderPilot/pages/`.
3. Add it (anonymised) under `tests/fixtures/amazon/` and assert on it in `tests/unit/amazon-parsers.test.ts`.

## Status

**Built (M0–M3 Amazon, M6 JioMart):**
- the engine (ladder, concurrency pool, payment guard, schemas)
- the Amazon cart, orders, tracking and invoices
- the side panel

**Started:**
- the Claude fallback (layer D), which needs your API key in **Settings**

**Next:**
- Flipkart (M5)
- Supabase sync (M7)
- polish (M8)

See `tasks/todo.md` for the full task list.

# Changing OrderPilot yourself

There are three ways to change OrderPilot. Pick the easiest one that does the job.

| You want to… | Do this | Code? |
|---|---|---|
| Change the check time, quantity rule, per-order cap, invoice folder or look-back days, which sites are checked, or the Claude model | Side panel → **Settings** | No |
| Fix a button or price that stopped being found because a shop renamed it | **Settings → Site selectors (advanced)** | No |
| Change behaviour or add a feature | Edit the code with live reload (below) | Yes |

---

## 1. Settings (no code)

All of these apply immediately.

- **Daily status check:**
  - check times (with an optional evening check)
  - sites to check
  - how far back to look for orders (**All orders** reads your whole history once, then only new pages)
  - parallel requests per site
- **Rules:**
  - quantity rule: *Reach the target* (default), *Closest to target*, or *Stay under target*
  - your own maximum quantity per order (0 means only the shop's limit)
  - raise attempts if the cart lands short
  - how many days to keep re-checking orders that are missing details
  - **GSTIN**: when set, the JioMart cart ticks *GST Invoice* and fills it in
  - invoice folder inside Downloads
  - how far back to collect invoices (0 = all orders)
  - **Excel report**: on/off and folder (an `.xlsx` with every order is saved after each check)
- **AI fallback:** your Claude key and the model.

## 2. Site selectors (no code)

When a shop renames something, the extension still works through its fallbacks (text matching, then Claude, then asking you), but it gets slower. To restore the fast path:

1. On the shop page, right-click the price or button → **Inspect**. Note its `class`, for example `NewPrice__value`.
2. Open **Settings → Site selectors (advanced)** → *Built-in selectors*. Pick the site and click the matching name, for example `product.currentPrice`. It's added to the box.
3. Fill in your selector and click **Save selectors**:

```json
{
  "jiomart": { "product.currentPrice": [".NewPrice__value"] },
  "amazon":  { "cart.subtotal": ["#sc-subtotal-amount-activecart .a-price"] }
}
```

Your selectors are tried first, and the built-in ones stay as backup, so a wrong entry can't break anything. **Reset to built-in** removes all of yours. Invalid CSS is rejected when you save.

## 3. Editing the code with live reload

**Once:**
1. Install [Node.js](https://nodejs.org) (LTS).
2. Install [VS Code](https://code.visualstudio.com) and open the `order-agent-extension` folder. Accept the recommended extensions it suggests.

**Every time:**
1. Double-click **`start-dev.bat`**, or run `npm run dev`. Leave the window open.
2. The first time only: in `chrome://extensions`, turn on **Developer mode**, then **Load unpacked** → `order-agent-extension\.output\chrome-mv3-dev`. Turn off the other OrderPilot copy so you don't have two.
3. Edit any file under `src\` and save. Chrome reloads the extension by itself; reopen the side panel to see UI changes.
4. When you're done, double-click **`test.bat`** to run all checks, then **`build.bat`** to make the normal build.

The dev copy and the normal copy keep separate saved data, because Chrome treats them as two different extensions. Pick one for daily use.

### Which file controls what

| What | File |
|---|---|
| Amazon class names and URLs | `src/adapters/amazon/selectors.ts` |
| JioMart class names, API paths, invoice links | `src/adapters/jiomart/selectors.ts` |
| How a page is read (price, cart, orders, tracking) | `src/adapters/<site>/parsers.ts` |
| Clicks and in-page steps (add to cart, quantity, coupon) | `src/adapters/<site>/actions.ts` |
| Cart Builder steps | `src/bg/jobs/cart.ts` (Amazon), `src/bg/jobs/cart-jiomart.ts` |
| Daily check | `src/bg/jobs/sweep.ts`, `src/bg/jobs/sweep-jiomart.ts` |
| Invoices and ZIPs | `src/bg/jobs/invoices.ts`, `src/core/zip.ts` |
| Quantity math | `src/core/qty.ts` |
| Order status words → status | `src/core/status.ts` |
| Payment guard (what may never be clicked) | `src/core/actions.ts` (`PAYMENT_PATTERNS`, `CHECKOUT_ALLOWED`) |
| The A→E layers, speed, backoff | `src/core/ladder.ts`, `src/core/pool.ts`, `src/bg/read.ts` |
| Settings and their defaults | `src/core/settings.ts` |
| Side panel screens | `src/ui/pages/*.tsx`; colours in `src/entrypoints/sidepanel/style.css` |

### Common edits

**A new status word.** Add it to the right rule in `src/core/status.ts`. For example, add `|handed to rider` to the "Out for delivery" line. Then run `npm test`.

**A new default selector.** Add it to the list in `selectors.ts`. Earlier entries are tried first.

**A new setting.**
1. Add the field and its default in `src/core/settings.ts`.
2. Add an input in `src/ui/pages/settings/RulesCard.tsx`.
3. Read it with `getSettings()` where it's needed.

### Rules to keep

- Never remove or weaken the payment guard (`PAYMENT_PATTERNS`, `CHECKOUT_ALLOWED`). The tests in `tests/unit/actions.test.ts` will fail if you do.
- Run `test.bat` before relying on a change. There are 101 unit tests and two simulated-site runs (Amazon and JioMart).
- Never commit real order pages or personal data to `tests/fixtures`. Use made-up values, as the existing fixtures do.

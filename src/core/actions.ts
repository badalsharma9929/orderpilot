// DOM action primitives used by content scripts. Every click in the
// extension goes through `safeClick`, which enforces the payment guard: the
// extension never confirms a payment, whichever layer chose the element.

import { BlockedError, type Strategy } from './ladder';

const PAYMENT_PATTERNS: RegExp[] = [
  /\bpay\b/i,
  /\bpay\s*now\b/i,
  /\bplace\s*(your\s*)?order\b/i,
  /\bbuy\s*now\b/i,
  /\bconfirm\s*(your\s*)?order\b/i,
  /\bproceed\s*to\s*pay/i,
  /\bmake\s*payment\b/i,
  /\bcomplete\s*(the\s*)?(purchase|payment)\b/i,
  /\buse\s*this\s*payment\s*method\b/i,
  /\bsubmit\s*order\b/i,
  /भुगतान/,
];

const PAYMENT_ATTR_HINTS = /placeYourOrder|place-order|placeorder|submitOrder|paynow|pay-now|payment-submit/i;

/** Everything a user or screen reader would read as this control's name. */
export function elementLabel(el: Element): string {
  const h = el as HTMLElement & { value?: string; labels?: NodeListOf<HTMLLabelElement> | null };
  const doc = el.ownerDocument;
  const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/).filter(Boolean).map((id) => doc.getElementById(id)?.textContent ?? '');
  const labels = h.labels ? Array.from(h.labels, (l) => l.textContent ?? '') : [];
  return [
    h.innerText ?? h.textContent ?? '',
    typeof h.value === 'string' ? h.value : '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('title') ?? '',
    el.getAttribute('alt') ?? '',
    ...labelledBy,
    ...labels,
  ].join(' ').replace(/\s+/g, ' ').trim();
}

const CONTROL = 'button, a, input, [role=button], [role=link], form';

function looksLikePayment(el: Element): boolean {
  if (PAYMENT_PATTERNS.some((p) => p.test(elementLabel(el)))) return true;
  const attrs = [el.id, el.getAttribute('name'), el.getAttribute('class'), el.getAttribute('data-testid'), el.getAttribute('formaction'), el.getAttribute('action')].join(' ');
  return PAYMENT_ATTR_HINTS.test(attrs);
}

/**
 * True if clicking `el` could trigger a payment: the element itself, any
 * interactive ancestor it sits inside (a span in a button), or the control a
 * <label> points at.
 */
export function isPaymentElement(el: Element): boolean {
  if (looksLikePayment(el)) return true;
  for (let n = el.parentElement; n && n !== el.ownerDocument.body; n = n.parentElement) {
    if (n.matches(CONTROL) && n.tagName !== 'FORM' && looksLikePayment(n)) return true;
    if (n.tagName === 'FORM') break;
  }
  const control = (el as HTMLLabelElement).control ?? (el.tagName === 'LABEL' ? el.querySelector('input, button') : null);
  return !!control && control !== el && looksLikePayment(control);
}

/** On checkout pages the only clicks allowed are the ones that open or apply a coupon. */
const CHECKOUT_ALLOWED: RegExp[] = [
  /^apply$/i,
  /\benter\s*(a\s*)?(gift\s*card|promo(tion)?|coupon)?\s*code\b/i,
  /\badd\s*(a\s*)?gift\s*card\s*or\s*promotion\s*code\b/i,
  /\bhave\s*a\s*(promo|coupon)\s*code\b/i,
  /^(apply\s*)?coupon$/i,
];

export const isCheckoutUrl = (url: string) =>
  /\/(gp\/buy|checkout|gp\/aw\/buy|payments?)\b/i.test(url) || /\/cart\/(delivery|payment-info|order-review)/i.test(url);

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const h = n as HTMLElement;
    if (h.hidden || n.getAttribute('aria-hidden') === 'true') return false;
    const cs = n.ownerDocument.defaultView?.getComputedStyle(h);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
  }
  return true;
}

export function isEnabled(el: Element): boolean {
  return !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';
}

/**
 * Clicks like a user: pointer + mouse sequence, then the native click.
 * Refuses payment controls everywhere, and on checkout pages refuses anything
 * that is not a coupon control.
 */
export function safeClick(el: Element, opts: { checkout?: boolean } = {}): void {
  const label = elementLabel(el);
  if (isPaymentElement(el)) throw new BlockedError('payment-guard', `refused to click "${label.slice(0, 60)}"`);
  const checkout = opts.checkout ?? isCheckoutUrl(el.ownerDocument.location?.href ?? '');
  if (checkout && !CHECKOUT_ALLOWED.some((p) => p.test(label))) {
    throw new BlockedError('payment-guard', `on checkout only coupon controls may be clicked; refused "${label.slice(0, 60)}"`);
  }
  const h = el as HTMLElement;
  h.scrollIntoView?.({ block: 'center', inline: 'center' });
  const view = el.ownerDocument.defaultView!;
  const ev = { bubbles: true, cancelable: true, button: 0 };
  const P = (view as any).PointerEvent ?? view.MouseEvent;
  el.dispatchEvent(new P('pointerdown', ev));
  el.dispatchEvent(new view.MouseEvent('mousedown', ev));
  el.dispatchEvent(new P('pointerup', ev));
  el.dispatchEvent(new view.MouseEvent('mouseup', ev));
  h.click();
}

/** Sets an input value so React/Angular/Vue notice it (native setter + input/change). */
export function setInputValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus?.();
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

export function findBySelectors(selectors: string[], root: ParentNode = document): Element | null {
  for (const sel of selectors) {
    let nodes: Element[];
    try { nodes = Array.from(root.querySelectorAll(sel)); } catch { continue; }
    const hit = nodes.find((n) => isVisible(n) && isEnabled(n));
    if (hit) return hit;
  }
  return null;
}

const CLICKABLE = 'button, a, input[type=submit], input[type=button], input[type=checkbox], [role=button], [role=link], [role=checkbox], label, [tabindex]';

/** Finds the tightest visible clickable element whose label matches one of the patterns. */
export function findByText(patterns: RegExp[], root: ParentNode = document, scope = CLICKABLE): Element | null {
  const nodes = Array.from(root.querySelectorAll(scope)).filter((n) => isVisible(n) && isEnabled(n));
  for (const p of patterns) {
    const matches = nodes.filter((n) => p.test(elementLabel(n)));
    if (matches.length) {
      // Prefer the innermost match (shortest label) to avoid clicking a big container.
      return matches.sort((a, b) => elementLabel(a).length - elementLabel(b).length)[0];
    }
  }
  return null;
}

export async function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs = 5000, intervalMs = 80, signal?: AbortSignal): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (signal?.aborted) throw new Error('aborted');
    if (Date.now() > end) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface ClickSpec {
  /** Layer B: CSS selectors in priority order. */
  selectors: string[];
  /** Layer C: visible text / aria patterns. */
  text: RegExp[];
  /** Must become true after the click for the step to count. */
  postCondition?: () => boolean;
  postTimeoutMs?: number;
  /** How long to wait for the element to appear before falling to the next layer. */
  findTimeoutMs?: number;
  root?: ParentNode;
}

/** Builds the B (selector) and C (semantic) click strategies for one action. */
export function clickStrategies(spec: ClickSpec): Strategy<true>[] {
  const after = async (signal: AbortSignal) => {
    if (spec.postCondition) await waitFor(() => spec.postCondition!(), spec.postTimeoutMs ?? 5000, 80, signal);
    return true as const;
  };
  return [
    {
      layer: 'B', name: 'selector-click', timeoutMs: 7000,
      run: async (signal) => {
        const el = await waitFor(() => findBySelectors(spec.selectors, spec.root), spec.findTimeoutMs ?? 1500, 50, signal);
        safeClick(el);
        return after(signal);
      },
    },
    {
      layer: 'C', name: 'semantic-click', timeoutMs: 7000,
      run: async (signal) => {
        const el = await waitFor(() => findByText(spec.text, spec.root), spec.findTimeoutMs ?? 1500, 50, signal);
        safeClick(el);
        return after(signal);
      },
    },
  ];
}

/** Compact, indexed list of clickable elements for the Claude-guided layer (D). */
export function clickableInventory(root: ParentNode = document, limit = 150) {
  const nodes = Array.from(root.querySelectorAll(CLICKABLE)).filter((n) => isVisible(n) && isEnabled(n));
  const checkout = isCheckoutUrl(document.location?.href ?? '');
  return nodes.slice(0, limit).map((el, index) => {
    const text = elementLabel(el).slice(0, 80);
    return {
      index,
      tag: el.tagName.toLowerCase(),
      text,
      blocked: isPaymentElement(el) || (checkout && !CHECKOUT_ALLOWED.some((p) => p.test(text))),
      el,
    };
  });
}

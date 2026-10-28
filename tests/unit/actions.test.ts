import { describe, it, expect, beforeEach } from 'vitest';
import { runLadder, BlockedError } from '@/core/ladder';
import { isPaymentElement, safeClick, setInputValue, findBySelectors, findByText, clickStrategies } from '@/core/actions';

beforeEach(() => { document.body.innerHTML = ''; });

describe('payment guard', () => {
  const blocked = [
    '<button>Place your order</button>',
    '<input type="submit" value="Place Order">',
    '<button>PAY ₹1,240</button>',
    '<button>Pay Now</button>',
    '<a role="button">Buy Now</a>',
    '<button aria-label="Confirm order"></button>',
    '<button>Use this payment method</button>',
    '<input name="placeYourOrder1" type="submit" value="">',
    '<button>भुगतान करें</button>',
  ];
  const allowed = [
    '<button>Add to Cart</button>',
    '<button>Apply</button>',
    '<input type="submit" value="Proceed to Buy">',
    '<button>Proceed to checkout</button>',
    '<button>Continue</button>',
    '<button>Paytm offers</button>',
  ];

  it.each(blocked)('blocks %s', (html) => {
    document.body.innerHTML = html;
    const el = document.body.firstElementChild!;
    expect(isPaymentElement(el)).toBe(true);
    expect(() => safeClick(el)).toThrow(BlockedError);
  });

  it.each(allowed)('allows %s', (html) => {
    document.body.innerHTML = html;
    expect(isPaymentElement(document.body.firstElementChild!)).toBe(false);
  });

  it('blocks an Amazon a-button whose text lives in an aria-labelledby span', () => {
    document.body.innerHTML = `<span class="a-button"><input id="b" class="a-button-input" type="submit" name="ppw-widgetEvent:SetPaymentPlanSelectContinueEvent" aria-labelledby="lbl">
      <span id="lbl" class="a-button-text">Use this payment method</span></span>`;
    expect(isPaymentElement(document.getElementById('b')!)).toBe(true);
  });

  it('blocks a span inside a payment button', () => {
    document.body.innerHTML = '<button id="b"><span id="s" tabindex="0">Place your order</span></button>';
    expect(isPaymentElement(document.getElementById('s')!)).toBe(true);
    document.body.innerHTML = '<button id="b" aria-label="Pay now"><span id="s" tabindex="0">→</span></button>';
    expect(isPaymentElement(document.getElementById('s')!)).toBe(true);
  });

  it('blocks a label tied to a payment control', () => {
    document.body.innerHTML = '<label id="l" for="pay">Continue</label><input id="pay" type="submit" value="Place Order">';
    expect(isPaymentElement(document.getElementById('l')!)).toBe(true);
  });

  it('on checkout pages only allows the coupon controls', () => {
    document.body.innerHTML = '<button id="c">Continue</button><a id="e" href="#">Enter code</a><input id="a" type="submit" value="Apply">';
    const onCheckout = { checkout: true };
    expect(() => safeClick(document.getElementById('c')!, onCheckout)).toThrow(BlockedError);
    expect(() => safeClick(document.getElementById('e')!, onCheckout)).not.toThrow();
    expect(() => safeClick(document.getElementById('a')!, onCheckout)).not.toThrow();
  });

  it('stops the whole ladder when a strategy lands on a payment button', async () => {
    document.body.innerHTML = '<button id="go">Place your order</button><button>Add to Cart</button>';
    const r = await runLadder({ site: 't', op: 'add', strategies: clickStrategies({ selectors: ['#go'], text: [/add to cart/i] }) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.blocked).toBe('payment-guard');
  });
});

describe('finders and clicks', () => {
  it('skips hidden and disabled matches', () => {
    document.body.innerHTML = '<button class="b" style="display:none">x</button><button class="b" disabled>y</button><button class="b">z</button>';
    expect(findBySelectors(['.b'])!.textContent).toBe('z');
  });

  it('falls back to the next selector when one is invalid or empty', () => {
    document.body.innerHTML = '<button id="real">ok</button>';
    expect(findBySelectors(['::bad::', '#missing', '#real'])!.id).toBe('real');
  });

  it('finds by text, preferring the innermost element', () => {
    document.body.innerHTML = '<div role="button"><button id="inner">Add to Cart</button> extra words here</div>';
    expect(findByText([/add to cart/i])!.id).toBe('inner');
  });

  it('semantic layer wins when selectors are stale, and the post-condition is checked', async () => {
    let count = 0;
    document.body.innerHTML = '<button>Add to Cart</button>';
    document.querySelector('button')!.addEventListener('click', () => { count++; });
    const r = await runLadder({
      site: 't', op: 'add',
      strategies: clickStrategies({ selectors: ['#stale'], text: [/add to cart/i], postCondition: () => count === 1 }),
    });
    expect(r.ok && r.layer).toBe('C');
    expect(count).toBe(1);
  });

  it('fails a click whose effect never appears', async () => {
    document.body.innerHTML = '<button id="b">Apply</button>';
    const r = await runLadder({
      site: 't', op: 'apply',
      strategies: clickStrategies({ selectors: ['#b'], text: [/apply/i], postCondition: () => false, postTimeoutMs: 100 }),
    });
    expect(r.ok).toBe(false);
  });

  it('setInputValue fires input and change', () => {
    document.body.innerHTML = '<input id="q">';
    const el = document.querySelector('input')!;
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push('input'));
    el.addEventListener('change', () => seen.push('change'));
    setInputValue(el, 'SAVE10');
    expect(el.value).toBe('SAVE10');
    expect(seen).toEqual(['input', 'change']);
  });
});

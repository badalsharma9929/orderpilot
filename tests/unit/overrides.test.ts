import { describe, it, expect, afterEach } from 'vitest';
import { applyOverrides, defaultSelectors, validateOverrides } from '@/core/overrides';
import { JIOMART } from '@/adapters/jiomart/selectors';
import { parseProduct } from '@/adapters/jiomart/parsers';

afterEach(() => applyOverrides({}));

describe('selector overrides', () => {
  it('lists every editable selector path with its defaults', () => {
    const d = defaultSelectors('jiomart');
    expect(d['product.currentPrice']).toContain('.PriceContainer__currentPrice');
    expect(Object.keys(d).length).toBeGreaterThan(20);
  });

  it('tries your selectors first and keeps the built-in ones', () => {
    applyOverrides({ jiomart: { 'product.currentPrice': ['.NewPrice__value'] } });
    expect(JIOMART.product.currentPrice[0]).toBe('.NewPrice__value');
    expect(JIOMART.product.currentPrice).toContain('.PriceContainer__currentPrice');
  });

  it('lets a renamed price class be fixed without code', () => {
    const html = '<h1 class="product-description__productTitle">Pen</h1><span class="NewPrice__value">₹25</span><button class="product-description__addToCartButton">Add</button>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const url = 'https://www.jiomart.com/product/pen-123';
    expect(parseProduct(doc, url).unitPrice).toBeNull();
    applyOverrides({ jiomart: { 'product.currentPrice': ['.NewPrice__value'] } });
    expect(parseProduct(doc, url).unitPrice).toBe(25);
  });

  it('resetting restores the defaults exactly', () => {
    applyOverrides({ jiomart: { 'product.currentPrice': ['.x'] } });
    applyOverrides({});
    expect(JIOMART.product.currentPrice).toEqual(defaultSelectors('jiomart')['product.currentPrice']);
  });

  it('rejects unknown sites, unknown paths and broken CSS', () => {
    expect(validateOverrides({ jiomart: { 'product.currentPrice': ['.ok'] } })).toEqual([]);
    expect(validateOverrides({ ebay: {} })[0]).toMatch(/Unknown site/);
    expect(validateOverrides({ jiomart: { 'product.nope': ['.a'] } })[0]).toMatch(/unknown path/);
    expect(validateOverrides({ jiomart: { 'product.currentPrice': ['..bad[['] } })[0]).toMatch(/invalid CSS/);
    expect(validateOverrides([])[0]).toMatch(/Must be an object/);
  });
});

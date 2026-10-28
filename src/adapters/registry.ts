import * as amazon from './amazon/parsers';
import * as jiomart from './jiomart/parsers';
import { JIOMART } from './jiomart/selectors';
import type { Platform } from '@/core/schemas';

type Parser = (doc: Document, url: string, args?: any) => unknown;
type JsonParser = (json: any, url: string, args?: any) => unknown;

/** Parsers over a rendered or fetched HTML page. */
export const PARSERS = {
  'amazon.account': (doc) => amazon.parseAccount(doc),
  'amazon.product': (doc, url) => amazon.parseProduct(doc, url),
  'amazon.cart': (doc) => amazon.parseCart(doc),
  'amazon.checkout': (doc) => amazon.parseCheckout(doc),
  'amazon.confirmation': (doc, url) => amazon.parseConfirmation(doc, url),
  'amazon.orderList': (doc) => amazon.parseOrderList(doc),
  'amazon.orderDetail': (doc, _url, args) => amazon.parseOrderDetail(doc, args?.orderId),
  'amazon.tracking': (doc) => amazon.parseTracking(doc),
  'amazon.invoiceLinks': (doc, url, args) => amazon.parseInvoiceLinks(doc, args?.orderId, new URL(url).origin),

  'jiomart.account': (doc) => jiomart.parseAccount(doc),
  'jiomart.product': (doc, url) => jiomart.parseProduct(doc, url),
  'jiomart.cart': (doc) => jiomart.parseCart(doc),
  'jiomart.coupon': (doc) => jiomart.parseCouponState(doc),
  'jiomart.confirmation': (doc, url) => jiomart.parseConfirmation(doc, url),
  'jiomart.orderListDom': (doc) => jiomart.parseOrderListDom(doc),
  'jiomart.shipmentDom': (doc, _url, args) => jiomart.parseShipmentDom(doc, args?.orderId),
} satisfies Record<string, Parser>;

/** Parsers over JSON from the site's own API (fetched with the session cookie). */
export const JSON_PARSERS = {
  'jiomart.api.session': (j) => jiomart.parseSessionJson(j),
  'jiomart.api.orders': (j) => jiomart.parseOrdersJson(j),
  'jiomart.api.order': (j, _u, args) => jiomart.parseOrderJson(j, args?.orderId),
  'jiomart.api.shipment': (j, _u, args) => jiomart.parseOrderJson(j, args?.orderId),
  'jiomart.api.cart': (j) => jiomart.parseCartJson(j),
} satisfies Record<string, JsonParser>;

export type HtmlParserName = keyof typeof PARSERS;
export type JsonParserName = keyof typeof JSON_PARSERS;
export type ParserName = HtmlParserName | JsonParserName;
export type ParserOutput<N extends ParserName> =
  N extends HtmlParserName ? ReturnType<(typeof PARSERS)[N]> :
  N extends JsonParserName ? ReturnType<(typeof JSON_PARSERS)[N]> : never;

export const isJsonParser = (p: ParserName): p is JsonParserName => p in JSON_PARSERS;

/** Headers the site's own API expects (public app credentials; the user session comes from cookies). */
export function apiHeaders(platform: Platform): Record<string, string> {
  if (platform === 'jiomart') return { Authorization: `Bearer ${btoa(`${JIOMART.appId}:${JIOMART.appToken}`)}`, Accept: 'application/json' };
  return { Accept: 'application/json' };
}

export const FLAGS: Record<Platform, (doc: Document, url: string) => { captcha: boolean; signedOut: boolean }> = {
  amazon: amazon.pageFlags,
  flipkart: () => ({ captcha: false, signedOut: false }),
  jiomart: jiomart.pageFlags,
};

export const platformOfParser = (p: ParserName) => p.split('.')[0] as Platform;

export function platformOfUrl(url: string): Platform | null {
  try {
    const h = new URL(url).hostname;
    if (/(^|\.)amazon\.in$/.test(h)) return 'amazon';
    if (/(^|\.)flipkart\.com$/.test(h)) return 'flipkart';
    if (/(^|\.)jiomart\.com$/.test(h)) return 'jiomart';
  } catch {}
  return null;
}

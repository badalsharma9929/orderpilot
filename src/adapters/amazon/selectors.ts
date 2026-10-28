// Amazon.in / business.amazon.in. Every list is tried in order; text-pattern
// fallbacks in parsers.ts cover layout changes the selectors miss.

export const AMAZON = {
  orderIdRe: /\b(\d{3}-\d{7}-\d{7})\b/,
  asinFromUrl: /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})/i,

  account: {
    greeting: ['#nav-link-accountList-nav-line-1', '#nav-link-accountList .nav-line-1', '#glow-ingress-line1', '[data-nav-role="signin"] .nav-line-1'],
    signedOutText: /hello,?\s*sign\s*in/i,
    businessName: ['#nav-link-accountList-nav-line-2 + span', '.ab-header-company-name', '#nav-ab-account-name'],
  },

  product: {
    title: ['#productTitle', '#title', 'h1 span#productTitle', 'h1'],
    price: [
      '#corePrice_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#apex_desktop .a-price .a-offscreen',
      '.priceToPay .a-offscreen',
      '#tp_price_block_total_price_ww .a-offscreen',
      '#price_inside_buybox',
      '#newBuyBoxPrice',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.a-price .a-offscreen',
    ],
    asin: ['input#ASIN', 'input[name="ASIN"]', '#averageCustomerReviews[data-asin]', '[data-asin]:not([data-asin=""])'],
    qtySelect: ['select#quantity', 'select[name="quantity"]'],
    availability: ['#availability', '#outOfStock', '#availabilityInsideBuyBox_feature_div'],
    addToCartForm: ['form#addToCart', 'form[action*="handle-buy-box"]', 'form[id*="addToCart"]'],
    addToCartButton: ['#add-to-cart-button', 'input[name="submit.add-to-cart"]', '#add-to-cart-button-ubb', 'input[name="submit.addToCart"]'],
    addToCartText: [/^add to cart$/i, /add to (cart|basket)/i, /कार्ट में जोड़ें/],
    couponCheckbox: ['#couponTextpctch input[type=checkbox]', '#vpcButton input[type=checkbox]', 'label[id^="couponText"] input', '#promoPriceBlockMessage_feature_div input[type=checkbox]'],
    couponText: [/apply\s+.*coupon/i, /clip\s+coupon/i],
  },

  cart: {
    url: '/gp/cart/view.html',
    item: ['#sc-active-cart .sc-list-item[data-asin]', '.sc-list-item[data-asin]', '[data-name="Active Items"] [data-asin]'],
    subtotal: [
      '#sc-subtotal-amount-activecart .a-price .a-offscreen',
      '#sc-subtotal-amount-activecart',
      '#sc-subtotal-amount-buybox .a-price .a-offscreen',
      '#sc-subtotal-amount-buybox',
      '[data-name="Subtotal"] .sc-price',
      '.sc-subtotal .sc-price',
    ],
    count: ['#nav-cart-count', '#sc-subtotal-label-activecart'],
    qtyInput: ['input[name="quantityBox"]', 'input.sc-quantity-textfield', '[data-a-selector="value"]'],
    qtySelect: ['select[name="quantity"]'],
    updateText: [/^update$/i],
    proceed: ['input[name="proceedToRetailCheckout"]', '#sc-buy-box-ptc-button input', '#sc-buy-box-ptc-button', 'a[name="proceedToRetailCheckout"]'],
    proceedText: [/proceed to (buy|checkout)/i],
  },

  checkout: {
    urlRe: /\/(gp\/buy|checkout|gp\/aw\/buy)\//,
    addressStepText: /(select a delivery address|choose a delivery address|deliver to this address)/i,
    paymentStepText: /(select a payment method|payment method|more ways to pay|apply gift card|enter code)/i,
    showCodeLink: ['a[data-action="toggle-claim-code"]', '#pp-gift-card-and-promo-link', '.pmts-add-cc-gc-promo a'],
    showCodeText: [/enter (gift card|promo(tion)?|coupon)?\s*code/i, /add (a )?gift card or promotion code/i, /have a (promo|coupon) code/i],
    codeInput: ['input[name="ppw-claimCode"]', 'input#gcpromoinput', 'input[name="claimCode"]', 'input[placeholder*="code" i]'],
    applyButton: ['input[name="ppw-claimCodeApplyPressed"]', 'input[name*="claimCodeApply"]', 'button[name*="claimCodeApply"]', '#gcApplyButtonId input'],
    applyText: [/^apply$/i],
    successText: /(promotion|promo|code)[^.\n]{0,60}(applied|redeemed|added)|has been applied|discount applied/i,
    errorText: /(not valid|invalid|expired|cannot be (applied|used)|isn'?t applicable|not applicable|doesn'?t apply|minimum)/i,
    totals: ['#subtotals-marketplace-table', '#spc-orderSummary', '.order-summary', '#subtotals'],
    promoLine: /promotion(s)? applied[^\n₹]*₹?\s*-?\s*([\d,]+(?:\.\d{1,2})?)|(?:coupon|promo|discount)[^\n₹]{0,30}-\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
    orderTotal: /order total\s*:?\s*\n?\s*₹?\s*([\d,]+(?:\.\d{1,2})?)/i,
  },

  confirmation: {
    urlRe: /\/(gp\/buy\/thankyou|checkout\/.*thankyou|gp\/buy\/spc\/handlers\/static-submit-decoupled)/i,
    text: /(order placed, thank you|thank you, your order has been placed|order has been placed|order confirmed)/i,
  },

  orders: {
    listUrls: (startIndex: number, filter = 'months-3') => [
      `/your-orders/orders?timeFilter=${filter}&startIndex=${startIndex}`,
      `/gp/your-account/order-history?orderFilter=${filter}&startIndex=${startIndex}`,
      `/gp/css/order-history?orderFilter=${filter}&startIndex=${startIndex}`,
    ],
    openListUrl: '/gp/your-account/order-history?orderFilter=open',
    card: ['.order-card', '.js-order-card', '.a-box-group.order', '[class*="order-card"]'],
    nextPage: ['.a-pagination .a-last a', 'ul.a-pagination li.a-last a'],
    detailUrls: (id: string) => [
      `/gp/your-account/order-details?orderID=${id}`,
      `/your-orders/order-details?orderID=${id}`,
      `/gp/css/summary/edit.html?orderID=${id}`,
    ],
    printUrl: (id: string) => `/gp/css/summary/print.html?orderID=${id}`,
    trackLink: ['a[href*="progress-tracker"]', 'a[href*="ship-track"]', 'a[href*="track-package"]'],
    itemTitle: ['.yohtmlc-item a.a-link-normal', '[data-component="itemTitle"] a', '.yohtmlc-product-title', 'a[href*="/dp/"] .a-truncate-full', 'a.a-link-normal[href*="/gp/product/"]'],
    invoiceLink: ['a[href*="invoice"]', 'a[href*="/documents/download/"]'],
    invoicePopoverUrl: (id: string) => `/gp/shared-cs/ajax/invoice/invoice.html?orderId=${id}&relatedRequestId=&isADriveSubscription=&isBookingOrder=0`,
  },

  tracking: {
    primary: ['#primaryStatus', '.pt-status-main-status', '[data-test-id="primary-status"]', '.milestone-primaryMessage', 'h1.pt-promise-main-slot'],
    secondary: ['#secondaryStatus', '.pt-status-secondary-status', '.milestone-secondaryMessage'],
    carrier: ['.carrierRelatedInfo-mfn-providerTitle', '#carrierRelatedInfo-container .a-size-medium', '.pt-delivery-card-carrier'],
    trackingId: ['.carrierRelatedInfo-trackingId-text', '.pt-delivery-card-trackingId', '[data-test-id="tracking-id"]'],
    eventDay: ['.tracking-event-date-header', '.a-text-bold.tracking-event-date'],
    eventRow: ['.tracking-event-row', '#tracking-events-container .a-row'],
  },
};

// JioMart (2026 site, built on the Fynd commerce platform). Class names come
// from JioMart's own theme bundles, e.g. "product-description__addToCartButton";
// each list is tried in order, and text patterns cover anything they miss.

export const JIOMART = {
  origin: 'https://www.jiomart.com',
  // Public storefront credentials embedded in every JioMart page (window.APP_DATA).
  appId: '685945f46c8c7aee3f3af605',
  appToken: 'TpKw7wD9h',

  productUrlRe: /\/product\/([a-z0-9-]+?-(\d+))\/?(?:[?#]|$)/i,
  orderIdRe: /\b(?:order\s*(?:id|number|no\.?|#)\s*[-:#]?\s*)([A-Z0-9][A-Z0-9-]{7,})\b/i,

  account: {
    initials: ['.header__userInitials', '.sidebar__userInitials', '[class*="header__userAvatar"]'],
    name: ['.sidebar__profileName', '.profile-view__ProfileViewTitleText'],
    phone: ['.sidebar__profileNumber'],
    loginLink: ['a[href*="/auth/login"]', 'a[href*="retail-auth/ui/login"]'],
  },

  product: {
    title: ['.product-description__productTitle', '.product-description__productHeader h1', 'h1'],
    // Verified on the live site 2026-10-09: .PriceContainer__currentPrice holds the selling price.
    currentPrice: ['.product-description__productInfoContent .PriceContainer__currentPrice', '.PriceContainer__currentPrice'],
    priceSection: ['.PriceContainer__priceContainer', '.product-description__priceSection', '.product-description__priceContainer', '.product-description__sizePrice'],
    markedPrice: ['.PriceContainer__originalPrice', '.PriceContainer__originalPriceWrapper', '.product-description__markedPrice', '.product-description__lineThrough'],
    addToCart: ['.product-description__addToCartButton', '.product-description__addToCartButtonContainer button'],
    addToCartText: [/^add(\s*to\s*cart)?$/i, /add to cart/i],
    counter: ['.product-description__quantityCounter'],
    qtyValue: ['.product-description__quantityValue'],
    qtyBtn: '.product-description__quantityBtn',
    maxQtyText: ['.product-description__maxQtyInfoText', '.product-description__maxQtyInfoBar'],
    notifyMe: ['.product-description__notifyMeButton', '.product-description__notifiedButton'],
  },

  cart: {
    path: '/cart/bag/',
    item: ['.cart-item__cartItem', '.cart__cartItem', '.cart__eachItemContainer'],
    name: ['.cart-item__productName', '.cart-item__itemname', '.cart-item__productname', '.cart__itemName'],
    qty: ['.cart-item__quantityDisplay', '.cart__QtyContainer'],
    plus: ['.cart-item__quantityBtnPlus'],
    minus: ['.cart-item__quantityBtnMinus'],
    price: ['.cart-item__priceCurrent', '.cart-item__currentPrice', '.cart-item__itemprice', '.cart__effectivePrice'],
    summary: ['.summary__priceSummaryContainer', '.summary__priceSummaryBody'],
    summaryRow: ['.summary__priceRow', '.summary__priceItem'],
    finalAmount: ['.summary__finalAmount', '.summary__total'],
    emptyCart: ['.cart__emptyCart'],
  },

  coupon: {
    open: ['.coupons__viewAllCoupon', '.coupons__applyCouponContainer', '.coupons__applyCouponFrame', '.coupons__applyCoupon'],
    openText: [/apply\s*coupon/i, /view\s*(all\s*)?coupons/i, /^coupons?$/i],
    input: ['.coupons__searchCouponInput', '.coupons__couponSearch input', '.coupons__drawerSearch input', 'input[placeholder*="coupon" i]'],
    apply: ['.coupons__searchContainer button', '.coupons__searchWrapper button', '.coupons__drawerSearch button'],
    applyText: [/^apply$/i],
    success: ['.coupons__couponSuccess', '.coupons__success', '.coupons__applyed', '.coupons__successTick'],
    error: ['.coupons__couponErrorMessage', '.coupons__couponError', '.coupons__searchContainerError', '.coupons__error'],
    remove: ['.coupons__couponRemove'],
  },

  // GST invoice on the cart page (verified in JioMart's theme code, 2026-10-09).
  gst: {
    checkbox: ['.cart__gstInvoiceCheckbox', 'input[class*="gstInvoiceCheckbox"]'],
    appliedNumber: ['.cart__gstNum', '[class*="gstInvoiceAppliedContainer"] [class*="gstNum"]'],
    appliedName: ['.cart__gstName'],
    input: ['.gst-info__gstInvoiceForm input', 'input[placeholder*="GSTIN" i]', 'input[maxlength="15"]'],
    submit: ['.gst-info__gstInvoiceActionButton'],
    submitText: [/^(submit|proceed|verify|validate|continue)$/i],
    confirmText: [/^confirm$/i],
    addressRadio: ['.gst-info__gstInvoiceDetailsAddressContentItemListRadio input', '[class*="gstInvoiceDetailsAddress"] input[type="radio"]'],
    error: ['.gst-info__gstErrorText'],
    panText: /add pan details|pan information required/i,
  },

  orderStatus: {
    pathRe: /\/cart\/order-status/i,
    orderId: ['.order-status__orderId', '.order-status__orderDetails'],
    failed: ['.order-status__paymentFailed', '.order-status__failedtext'],
  },

  orders: {
    listPath: '/profile/orders',
    shipmentPath: (id: string) => `/profile/orders/shipment/${id}`,
    shipmentLink: 'a[href*="/profile/orders/shipment/"]',
    // Fynd storefront API (verified on a logged-in account 2026-10-09): the
    // "/api" prefix is required, plus the public app header and the session cookie.
    api: {
      orders: (page: number) => `/api/service/application/order/v1.0/orders?page_no=${page}&page_size=20`,
      order: (id: string) => `/api/service/application/order/v1.0/orders/${encodeURIComponent(id)}`,
      shipment: (id: string) => `/api/service/application/order/v1.0/orders/shipments/${encodeURIComponent(id)}`,
      session: '/api/service/application/user/authentication/v1.0/session',
      cart: (pincode?: string) => `/api/service/application/cart/v1.0/detail?i=true&b=true${pincode ? `&area_code=${pincode}` : ''}`,
      cartUpdate: (cartId: string) => `/api/service/application/cart/v1.0/detail?i=true&b=true&id=${encodeURIComponent(cartId)}`,
      coupon: (cartId: string) => `/api/service/application/cart/v1.0/coupon?i=true&b=true&id=${encodeURIComponent(cartId)}`,
    },
    // JioMart's own shipment endpoint carries the invoice token the PDF link needs.
    shipmentDetails: (id: string) => `/ext/hellcat/details/${encodeURIComponent(id)}/`,
    invoicePdf: (token: string) => `/ext/hellcat/shipment/invoice/?invoice_url=${encodeURIComponent(token)}`,
  },

  shipment: {
    status: ['.shipment__statusTitle', '.shipment__trackingStatus', '.shipment__trackingTitle', '.shipment__horizontalStatusTitle'],
    statusSub: ['.shipment__statusSubtitle', '.shipment__statusDescription', '.shipment__trackingSubtitle'],
    timelineItem: ['.shipment__timelineItem', '.shipment__statusItem', '.shipment__horizontalStatusItem'],
    timelineTitle: ['.shipment__timelineTitle', '.shipment__statusText', '.shipment__horizontalStatusTitle'],
    timelineDate: ['.shipment__timelineDate', '.shipment__time', '.shipment__horizontalStatusSubtitle'],
    item: ['.shipment__itemCard', '.shipment__itemContainer'],
    itemName: ['.shipment__itemName'],
    itemQty: ['.shipment__itemQuantity'],
    itemPrice: ['.shipment__itemPrice', '.shipment__currentPrice'],
    paymentMode: ['.shipment__paymentMode', '.shipment__paymentValue'],
    address: ['.shipment__customerAddress', '.shipment__addressText', '.shipment__addressDetails'],
    partner: ['.shipment__partnerName'],
    totalRow: ['.shipment__totalRow', '.shipment__priceSummary'],
    invoiceButton: ['[class*="downloadButton"]'],
  },
};

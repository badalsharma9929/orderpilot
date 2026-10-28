// JioMart fixtures. Field names/structure mirror responses verified on a real
// logged-in account (2026-10-09); every value here is synthetic.

const shipment = (id: string, status: { title: string; value: string }, steps: string[], extra: Record<string, unknown> = {}) => ({
  shipment_id: id,
  order_id: extra.order_id ?? 'FY6ABC1DEF2345678GHI',
  shipment_status: { hex_code: '#62B134', ...status },
  tracking_details: steps.map((t, i) => ({ text: t, status: t, state: t, is_passed: true, is_current: i === steps.length - 1, time: `2026-10-0${i + 1}T10:00:00+05:30`, created_ts: '' })),
  awb_no: '', dp_name: '', traking_no: '', track_url: '',
  delivery_date: '2026-10-04T12:57:00+05:30',
  delivery_address: { city: 'DELHI', pincode: '110092', name: 'X', phone: '0', address: 'x' },
  bags: [{ quantity: 10, item: { id: 7527060, name: 'Quickwork A4 Notebook Pack of 5', slug_key: 'quickwork-a4-notebook-7527060' }, prices: { price_effective: 199, price_marked: 400, amount_paid: 1990 } }],
  invoice: { store_invoice_id: 'JM00001234', invoice_url: '', label_url: '' },
  show_download_invoice: true,
  fulfilling_store: { name: 'JioMart Store Delhi' },
  ...extra,
});

const breakup = (total: number, coupon = 0) => [
  { name: 'mrp_total', display: 'MRP Total', value: 4000 },
  { name: 'discount', display: 'Discount', value: -2010 },
  { name: 'coupon', display: 'Coupon', value: -coupon },
  { name: 'sub_total', display: 'Sub Total', value: 1990 },
  { name: 'total', display: 'Amount Paid', value: total },
];

export const ordersPage1 = {
  items: [
    {
      order_id: 'FY6ABC1DEF2345678GHI', order_created_time: '2026-10-01T00:28:03.000Z', order_created_ts: '',
      breakup_values: breakup(1790, 200),
      payment_info: [{ display_name: 'UPI', mode: 'JIOPP', payment_mode: 'PREPAID' }],
      shipments: [shipment('6ABD5BBB0121SHIPOPEN01', { title: 'In Transit', value: 'in_transit' }, ['Processing', 'Confirmed', 'In Transit'], { delivery_date: '2026-10-11T12:00:00+05:30' })],
    },
    {
      order_id: 'FY6ZZZ9YYY8888777XXX', order_created_time: '2026-09-20T09:00:00.000Z', order_created_ts: '',
      breakup_values: breakup(1990),
      payment_info: [{ display_name: 'Card', mode: 'JIOPP', payment_mode: 'PREPAID' }],
      shipments: [shipment('6ABD5BBB0121SHIPDONE02', { title: 'Delivered', value: 'delivered' }, ['Processing', 'Confirmed', 'In Transit', 'Delivered'], { order_id: 'FY6ZZZ9YYY8888777XXX' })],
    },
  ],
  page: { current: 1, has_next: false, item_total: 2, size: 20, type: 'number' },
  filters: {},
};

/** JioMart's /ext/hellcat/details/<id>/ — generic title, real status in value, invoice token present. */
export const hellcatDetails = (id: string, orderId: string, delivered: boolean) => ({
  shipment: shipment(id, delivered ? { title: 'Order Status', value: 'Delivered On Oct 4' } : { title: 'Order Status', value: 'Out For Delivery' },
    delivered ? ['Ordered', 'Under Process', 'Shipped', 'Delivered'] : ['Ordered', 'Under Process', 'Shipped'], {
      order_id: orderId,
      breakup_values: breakup(delivered ? 1990 : 1790, delivered ? 0 : 200),
      invoice_url: `TOKEN${id}abcdef0123456789`,
      encrypted_invoice_url: true,
      invoice: { store_invoice_id: `JMINV${id.slice(-4)}`, invoice_url: '', label_url: '' },
    }),
});

export const session = { user: { first_name: 'Badal', last_name: 'K', phone_numbers: [{ phone: '9000000000', primary: true }] } };

export const cartJson = (qty: number, couponApplied = false) => ({
  id: 'cart-123', cart_id: 1,
  items: qty ? [{
    product: { uid: 7527060, name: 'Quickwork A4 Notebook Pack of 5', slug: 'quickwork-a4-notebook-7527060' },
    article: { uid: 'art-1', size: 'OS' },
    identifiers: { identifier: 'ident-1' },
    quantity: qty,
    price: { converted: { effective: 199 * qty, marked: 400 * qty } },
  }] : [],
  breakup_values: {
    raw: { subtotal: 199 * qty, total: 199 * qty - (couponApplied ? 200 : 0), coupon: couponApplied ? -200 : 0, mrp_total: 400 * qty },
    coupon: { code: couponApplied ? 'JMSAVE200' : '', is_applied: couponApplied, message: couponApplied ? 'Coupon applied successfully' : '', minimum_cart_value: 1500, value: 200 },
  },
});

export const productPage = (slug: string) => `
<div class="header__userInitials">BK</div>
<div class="product-description__productHeader"><h1 class="product-description__productTitle">Quickwork A4 Notebook Pack of 5</h1></div>
<div class="product-description__priceSection"><span>₹199</span><span class="product-description__markedPrice">₹400</span><span class="product-description__discountBadge">50% OFF</span></div>
<div class="product-description__maxQtyInfoBar"><span class="product-description__maxQtyInfoText">Max 12 qty per order</span></div>
<div class="product-description__addToCartButtonContainer"><button class="product-description__addToCartButton">Add</button></div>
<script>window.APP_DATA = {"reduxData":{"auth":{"logged_in":false},"catalog":{"product_details":{"slug":"${slug}","uid":7527060,"name":"Quickwork A4 Notebook Pack of 5","attributes":{"max-qty-in-order":"12"}}}}};</script>`;

export const cartPageDom = `
<div class="cart-item__cartItem"><a href="/product/quickwork-a4-notebook-7527060">x</a>
  <div class="cart-item__productName">Quickwork A4 Notebook Pack of 5</div>
  <div class="cart-item__quantityControls"><button class="cart-item__quantityBtnMinus">-</button><span class="cart-item__quantityDisplay">10</span><button class="cart-item__quantityBtnPlus">+</button></div>
  <div class="cart-item__priceCurrent">₹1,990</div></div>
<div class="summary__priceSummaryContainer">
  <div class="summary__priceRow"><span>Item Total</span><span>₹1,990</span></div>
  <div class="summary__priceRow"><span>Coupon Discount</span><span>-₹200</span></div>
  <div class="summary__finalAmount">₹1,790</div></div>`;

export const orderStatusPage = `<div class="order-status__orderSuccessMsg">Order placed successfully</div><div class="order-status__orderId">Order ID: FY6NEW0000111122223333</div>`;

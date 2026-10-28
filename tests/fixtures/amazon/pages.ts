// Synthetic pages modelled on amazon.in markup. Replace/extend with real,
// anonymised pages captured via Settings → "Save this page for tuning".

export const product = `
<div id="nav-link-accountList"><span id="nav-link-accountList-nav-line-1">Hello, Badal</span></div>
<span id="productTitle"> Classmate Notebook 172 pages (Pack of 6) </span>
<div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">₹499.00</span></span></div>
<div id="availability"><span>In stock</span></div>
<form id="addToCart" action="/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance" method="post">
  <input type="hidden" id="ASIN" name="ASIN" value="B0TESTASIN">
  <input type="hidden" name="anti-csrftoken-a2z" value="tok">
  <select id="quantity" name="quantity"><option value="1">1</option><option value="2">2</option><option value="30">30</option></select>
  <input id="add-to-cart-button" name="submit.add-to-cart" type="submit" value="Add to Cart">
</form>
<div id="promoPriceBlockMessage_feature_div"><label id="couponText1"><input type="checkbox"> Apply ₹50 coupon</label></div>`;

export const signedOut = `<span id="nav-link-accountList-nav-line-1">Hello, sign in</span>`;

export const captcha = `<form action="/errors/validateCaptcha"><p>Enter the characters you see below</p><input id="captchacharacters"></form>`;

export const cart = `
<div id="sc-active-cart">
  <div class="sc-list-item" data-asin="B0TESTASIN" data-quantity="11" data-price="499.0">
    <span class="sc-product-title">Classmate Notebook</span>
  </div>
  <div class="sc-list-item" data-asin="B0OTHER001" data-quantity="1" data-price="120">
    <span class="sc-product-title">Pen</span>
  </div>
</div>
<span id="sc-subtotal-label-activecart">Subtotal (12 items):</span>
<span id="sc-subtotal-amount-activecart"><span class="a-price"><span class="a-offscreen">₹5,609.00</span></span></span>
<input name="proceedToRetailCheckout" type="submit" value="Proceed to Buy">`;

export const paymentOk = `
<h1>Select a payment method</h1>
<div class="pmts-claim-code-success">Your promotion code SAVE10 has been applied.</div>
<input name="ppw-claimCode" value="SAVE10"><input name="ppw-claimCodeApplyPressed" type="submit" value="Apply">
<div id="subtotals-marketplace-table">
  <div>Items: ₹5,609.00</div>
  <div>Promotion Applied: -₹560.90</div>
  <div>Order Total: ₹5,048.10</div>
</div>`;

export const paymentBad = `
<h1>Select a payment method</h1>
<div class="a-alert-error"><div class="a-alert-content">The promotional code you entered is not valid.</div></div>
<input name="ppw-claimCode" value="NOPE">`;

export const thankYou = `<h4>Order placed, thank you!</h4><p>Order #403-1234567-7654321 and 171-1111111-2222222</p>`;

export const orderList = `
<div class="order-card js-order-card">
  <div><span>Order placed</span><span>1 October 2026</span></div>
  <div><span>Total</span><span>₹5,048.10</span></div>
  <div><span>Order #</span><span dir="ltr">403-1234567-7654321</span></div>
  <div><span>Arriving tomorrow</span></div>
  <a href="/gp/your-account/order-details?orderID=403-1234567-7654321">View order details</a>
</div>
<div class="order-card js-order-card">
  <div><span>Order placed</span><span>28 September 2026</span></div>
  <div><span>Total</span><span>₹999.00</span></div>
  <div><span>Order #</span><span dir="ltr">171-1111111-2222222</span></div>
  <div><span>Delivered 30-Sept-2026</span></div>
</div>
<p>Also see 402-9999999-0000001 in a redesigned block</p>
<ul class="a-pagination"><li class="a-last"><a href="/gp/your-account/order-history?startIndex=10">Next</a></li></ul>`;

export const orderDetail = `
<div><span>Ordered on 1 October 2026</span><span>Order# 403-1234567-7654321</span></div>
<div class="yohtmlc-shipment-status-primaryText">Arriving tomorrow</div>
<div class="a-fixed-left-grid"><a class="a-link-normal" href="/gp/product/B0TESTASIN/ref=x">Classmate Notebook 172 pages</a>
  <span>Sold by: Cocoblu Retail</span><span class="item-view-qty">11</span><span class="a-color-price">₹499.00</span></div>
<a href="/progress-tracker/package/ref=ppx?orderId=403-1234567-7654321&shipmentId=Abc">Track package</a>
<a href="/gp/shared-cs/ajax/invoice/invoice.html?orderId=403-1234567-7654321">Invoice</a>
<div><h5>Shipping Address</h5><div>B. K.</div><div>Flat 5, MG Road</div><div>NEW DELHI, DELHI 110001</div><div>India</div></div>
<div><span>Payment Method</span><span>UPI</span></div>
<div><span>Item(s) Subtotal:</span><span>₹5,609.00</span></div>
<div><span>Promotion Applied:</span><span>-₹560.90</span></div>
<div><span>Grand Total:</span><span>₹5,048.10</span></div>`;

export const tracking = `
<div id="primaryStatus">Arriving Tuesday</div>
<div id="secondaryStatus">Out for delivery</div>
<div class="carrierRelatedInfo-mfn-providerTitle">Shipped with Delhivery</div>
<div class="pt-delivery-card-trackingId">Tracking ID: 1234567890123</div>
<div id="tracking-events-container">
  <div class="tracking-event-date-header">Monday, 6 October</div>
  <div class="a-row tracking-event-row"><span>10:15 AM</span><span>Package arrived at the carrier facility</span><span>Bhiwandi</span></div>
</div>`;

export const trackingDelivered = `<div id="primaryStatus">Delivered 7 October</div><div class="pt-delivery-card-trackingId">Tracking ID: 1234567890123</div>`;

export const invoicePopover = `
<ul><li><a href="/gp/css/summary/print.html?orderID=403-1234567-7654321">Printable Order Summary</a></li>
<li><a href="/documents/download/9f8e7d6c-1111/invoice.pdf">Invoice 1</a></li>
<li><a href="/documents/download/aa11bb22-2222/invoice.pdf">Invoice 2</a></li></ul>`;

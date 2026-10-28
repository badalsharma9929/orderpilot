import { defineContentScript } from '#imports';
import { installHandler } from '@/cs/handler';
import { jiomartActions } from '@/adapters/jiomart/actions';
import { parseConfirmation, parseAccount } from '@/adapters/jiomart/parsers';

export default defineContentScript({
  matches: ['https://*.jiomart.com/*'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    if (!installHandler(jiomartActions)) return; // a live copy already runs in this page

    // Order capture: JioMart lands on /cart/order-status after a successful payment.
    // It is a single-page app, so watch for client-side navigation too.
    let reported = '';
    const capture = () => {
      const ids = parseConfirmation(document, location.href);
      const key = ids.join(',');
      if (!ids.length || key === reported) return false;
      reported = key;
      chrome.runtime.sendMessage({
        kind: 'bg', op: 'orders.captured', platform: 'jiomart', orderIds: ids,
        account: parseAccount(document)?.name, origin: location.origin,
      });
      return true;
    };
    let lastUrl = '';
    setInterval(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; reported = reported && location.href.includes('order-status') ? reported : ''; }
      if (/\/cart\/order-status/.test(location.href)) capture();
    }, 1000);
  },
});

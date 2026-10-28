import { defineContentScript } from '#imports';
import { installHandler } from '@/cs/handler';
import { amazonActions } from '@/adapters/amazon/actions';
import { parseConfirmation, parseAccount } from '@/adapters/amazon/parsers';

export default defineContentScript({
  matches: ['https://*.amazon.in/*'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    if (!installHandler(amazonActions)) return; // a live copy already runs in this page

    // Flow 2: capture order IDs the moment the thank-you page renders.
    const capture = () => {
      const ids = parseConfirmation(document, location.href);
      if (!ids.length) return false;
      chrome.runtime.sendMessage({
        kind: 'bg', op: 'orders.captured', platform: 'amazon', orderIds: ids,
        account: parseAccount(document)?.name, origin: location.origin,
      });
      return true;
    };
    if (!capture() && /thankyou|static-submit|order-confirmation/i.test(location.href)) {
      // Confirmation content can stream in after load.
      let tries = 0;
      const t = setInterval(() => { if (capture() || ++tries > 20) clearInterval(t); }, 500);
    }
  },
});

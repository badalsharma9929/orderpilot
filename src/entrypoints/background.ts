import { defineBackground } from '#imports';
import type { BgRequest } from '@/core/messaging';
import { runCart, cancelCart } from '@/bg/jobs/cart';
import { runSweep, captureOrders } from '@/bg/jobs/sweep';
import { runInvoices, zipPending } from '@/bg/jobs/invoices';
import { exportReport } from '@/bg/jobs/report';
import { ALARM_CATCHUP, ALARM_EVENING, ALARM_MORNING, missedToday, scheduleAlarms } from '@/bg/alarms';
import { exclusive } from '@/bg/progress';
import { sendToTab } from '@/bg/tabs';
import { resetBreaker } from '@/bg/read';
import { watchOverrides } from '@/core/overrides';

export default defineBackground(() => {
  watchOverrides().catch(() => {});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.runtime.onInstalled.addListener(() => { scheduleAlarms(); });
  chrome.runtime.onStartup.addListener(async () => {
    await scheduleAlarms();
    if (await missedToday()) exclusive('sweep', () => runSweep());
  });

  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name === ALARM_MORNING || a.name === ALARM_EVENING) exclusive('sweep', () => runSweep());
    if (a.name === ALARM_CATCHUP && (await missedToday())) exclusive('sweep', () => runSweep());
  });

  chrome.runtime.onMessage.addListener((msg: BgRequest, sender, sendResponse) => {
    if (msg?.kind !== 'bg') return;
    handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  });
});

async function handle(msg: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.op) {
    case 'cart.run':
      return exclusive('cart', () => runCart(msg.input));
    case 'cart.cancel':
      cancelCart();
      return { ok: true };
    case 'sweep.run':
      resetBreaker(); // you asked for it: try again even if a site was paused
      return exclusive('sweep', () => runSweep(msg.platforms));
    case 'invoices.run':
      return exclusive('invoices', () => runInvoices());
    case 'report.export':
      return exportReport();
    case 'invoices.zipRange':
      return { ok: true, zips: await zipPending((r) => !!r.fetchedDay && r.fetchedDay >= msg.from && r.fetchedDay <= msg.to && r.zippedAt !== 'duplicate' && (!msg.accountId || r.accountId === msg.accountId)) };
    case 'orders.captured':
      await captureOrders(msg.platform, msg.orderIds, msg.account, msg.origin);
      return { ok: true };
    case 'alarms.reschedule':
      await scheduleAlarms();
      return { ok: true };
    case 'page.save': {
      // Saves the current page's HTML so selectors can be tuned against real markup.
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return { ok: false, error: 'no tab' };
      const r = await sendToTab<{ html: string; url: string }>(tab.id, { kind: 'cs', op: 'pageHtml' });
      const name = new URL(r.url).pathname.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'page';
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(`<!-- ${r.url} -->\n${r.html}`)}`;
      await chrome.downloads.download({ url, filename: `OrderPilot/pages/private-${Date.now()}_${name}.html`, saveAs: false });
      return { ok: true };
    }
  }
}

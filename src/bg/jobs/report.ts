import { cleanFolder, getSettings } from '@/core/settings';
import { reportFileName } from '@/core/report';
import { localDay } from '@/db/repo';
import { emit } from '../progress';
import { toOffscreen } from '../offscreen';
import { logError } from '../errors';

/** Builds the Excel report (in the offscreen page, which can make a file URL) and saves it to Downloads. */
export async function exportReport(): Promise<{ ok: boolean; filename?: string; orders?: number; error?: string }> {
  const cfg = await getSettings();
  const filename = `${cleanFolder(cfg.reportFolder)}/${reportFileName(localDay())}`;
  try {
    const r = await toOffscreen<{ ok: boolean; url?: string; orders?: number; message?: string }>({ kind: 'offscreen', op: 'buildReport' });
    if (!r.ok || !r.url) throw new Error(r.message ?? 'report build failed');
    // Same file name per day: a later check that day replaces the earlier report.
    await chrome.downloads.download({ url: r.url, filename, conflictAction: 'overwrite', saveAs: false });
    setTimeout(() => toOffscreen({ kind: 'offscreen', op: 'revoke', url: r.url! }).catch(() => {}), 120000);
    emit('sweep', `Excel saved: ${filename} (${r.orders} orders)`, { ok: true });
    return { ok: true, filename, orders: r.orders };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logError('fetch-failed', `Excel report not saved: ${error}`);
    return { ok: false, error };
  }
}

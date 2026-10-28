import { db, type ErrorRow } from '@/db/dexie';
import type { Platform } from '@/core/schemas';

/** Records a problem under "Needs attention"; one open row per order and kind. */
export async function logError(kind: ErrorRow['kind'], message: string, platform?: Platform, orderKey?: string) {
  if (orderKey) {
    const prev = await db.errors.where('orderKey').equals(orderKey).filter((e) => e.kind === kind && !e.resolved).first();
    if (prev) { await db.errors.update(prev.id!, { at: new Date().toISOString(), message }); return; }
  }
  await db.errors.add({ at: new Date().toISOString(), kind, platform, orderKey, message, resolved: 0 });
}

/** An order read cleanly: its open problems are solved. */
export async function resolveOrderErrors(orderKey: string, stillIncomplete = false) {
  await db.errors.where('orderKey').equals(orderKey)
    .filter((e) => !e.resolved && (e.kind !== 'incomplete' || !stillIncomplete))
    .modify({ resolved: 1 });
}

/** A site answered for a signed-in account: older "log in" and list errors for it are solved. */
export async function resolveSiteErrors(platform: Platform) {
  await db.errors.where('resolved').equals(0)
    .filter((e) => e.platform === platform && !e.orderKey && (e.kind === 'login-needed' || e.kind === 'fetch-failed' || e.kind === 'blocked'))
    .modify({ resolved: 1 });
}

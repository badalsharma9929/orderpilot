export const invoiceKey = (platform: string, accountId: string, orderId: string, invoiceNo: string) =>
  [platform, accountId, orderId, invoiceNo].map((s) => s.trim().toLowerCase()).join('|');

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface KnownInvoices {
  keys: Set<string>;
  hashes: Set<string>;
}

/** Decides whether a fetched invoice is new. Checked by key before download and by hash after. */
export function isNewInvoice(known: KnownInvoices, key: string, hash?: string): boolean {
  if (known.keys.has(key)) return false;
  if (hash && known.hashes.has(hash)) return false;
  return true;
}

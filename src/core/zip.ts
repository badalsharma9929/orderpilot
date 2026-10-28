import JSZip from 'jszip';

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'unknown';

export function zipDownloadPath(day: string, platform: string, account: string, base = 'OrderPilot/Invoices') {
  const acc = safeName(account);
  return `${base}/${acc}/${day}_${platform}_${acc}.zip`;
}

export function invoiceFileName(platform: string, orderId: string, invoiceNo: string) {
  return `${platform}_${safeName(orderId)}_${safeName(invoiceNo)}.pdf`;
}

export interface ZipEntry { name: string; data: Blob | ArrayBuffer | Uint8Array }

export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const e of entries) {
    let name = e.name;
    for (let i = 2; used.has(name); i++) name = e.name.replace(/\.pdf$/i, `_${i}.pdf`);
    used.add(name);
    zip.file(name, e.data);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

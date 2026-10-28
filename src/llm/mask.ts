// Masks personal data before any page text leaves the browser for Claude.
// Order IDs, AWBs, prices and dates are kept: they are what we need extracted.

const RULES: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/(?<![\w-])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\w-])/g, '[phone]'],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b(?!-)/g, '[id-number]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[pan]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[card]'],
];

const TRACKING_LABEL = /(awb|tracking\s*(id|no\.?|number|#)|consignment|waybill|shipment\s*id|order\s*(id|#|no))\W{0,6}$/i;

// Lines that look like a postal address (house/flat/street words) are dropped,
// but the 6-digit pincode and city are kept for the record.
const ADDRESS_LINE = /\b(flat|house|h\.?\s?no|plot|floor|street|road|lane|nagar|colony|sector|apartment|apt|near|opp\.?|behind|landmark)\b/i;

const ADDRESS_HEADING = /^(shipping|delivery|billing|deliver(ing)?\s+to|ship\s+to)\b.*address|^(shipping|delivery|billing)\s+address\b|^address$/i;
const NAME_PREFIX = /^((?:hello|hi|namaste),?\s+|deliver(?:ing)?\s+to:?\s+|ship\s+to:?\s+|sold\s+to:?\s+|bill\s+to:?\s+)(.+)$/i;
const PINCODE = /\b\d{6}\b/;

export function maskPII(text: string): string {
  const lines = text.split('\n');
  const out1: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const named = line.match(NAME_PREFIX);
    if (named) { out1.push(`${named[1]}[name]`); continue; }
    if (ADDRESS_HEADING.test(line.trim())) {
      out1.push(line);
      // Mask the block under the heading; keep only the "CITY, STATE 110001" line.
      let j = i + 1;
      for (; j < lines.length && j <= i + 6; j++) {
        if (PINCODE.test(lines[j])) { out1.push(lines[j]); j++; break; }
        out1.push('[address line]');
      }
      i = j - 1;
      continue;
    }
    out1.push(ADDRESS_LINE.test(line) ? '[address line]' : line);
  }
  let out = out1.join('\n');
  for (const [re, rep] of RULES) {
    out = out.replace(re, (m: string, ...rest: unknown[]) => {
      const offset = rest.find((x) => typeof x === 'number') as number;
      // A 10-digit AWB looks like a mobile number; keep anything labelled as tracking.
      if (rep === '[phone]' || rep === '[id-number]' || rep === '[card]') {
        const before = out.slice(Math.max(0, offset - 40), offset);
        if (TRACKING_LABEL.test(before)) return m;
      }
      return rep;
    });
  }
  return out;
}

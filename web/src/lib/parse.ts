import { iso } from './format';

/** A spreadsheet or CSV cell as a calendar date (YYYY-MM-DD), or null. */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 864e5));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const t = String(v ?? '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // assume MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : iso(d);
}

/** A money cell ("$1,234.50", "(12.00)", 99) in cents, keeping the sign. NaN if not a number. */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  const t = String(v ?? '').trim();
  if (!t) return NaN;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = parseFloat(t.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) * (neg ? -1 : 1) : NaN;
}

export const cellText = (v: unknown) => (v instanceof Date ? parseDate(v) || '' : String(v ?? '').trim());

export const EXPENSE_CATEGORIES = [
  'Production & Manufacturing', 'Blanks & Materials', 'Samples & Development', 'Packaging & Shipping',
  'Marketing & Ads', 'Photography & Content', 'Software & Subscriptions', 'Studio & Rent', 'Events & Pop-ups',
  'Professional Fees', 'Bank & Payment Fees', 'Equipment', 'Travel & Transport', 'Miscellaneous',
];
export const INCOME_CATEGORIES = ['Online Sales', 'Wholesale', 'Events & Pop-ups', 'Custom Orders', 'Collaborations', 'Refunds', 'Other Income'];
export const LINES = ['Shared', 'RVS', 'Reveillerstudios'];
export const RUN_STATUSES = ['Planning', 'In production', 'Selling', 'Sold out'];
export const FREQ: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

const CAD = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
export const fmt = (cents: number) => CAD.format((cents || 0) / 100);
export const fmtK = (cents: number) => {
  const d = cents / 100;
  const a = Math.abs(d);
  return a >= 1000 ? `$${(d / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `$${Math.round(d)}`;
};
/** Parse "1,234.56" or "$12" into cents. NaN when invalid. */
export const toCents = (v: string | number | null | undefined) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const centsInput = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return iso(new Date(y, m - 1, d + n));
};
export const parseD = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const monthOf = (s: string) => (s || '').slice(0, 7);
export const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const monthLabel = (ym: string, short = false) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
};
export const dayLabel = (s?: string | null) => (s ? parseD(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '');
/** "Mar 1" this year, "Mar 1, 2025" otherwise. */
export const dayLabelY = (s?: string | null) => (s ? parseD(s).toLocaleDateString('en-CA', s.slice(0, 4) === String(new Date().getFullYear()) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '');
export const longDate = (s?: string | null) => (s ? parseD(s).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
export const daysBetween = (a: string, b: string) => Math.round((parseD(b).getTime() - parseD(a).getTime()) / 864e5);
export const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + (f(x) || 0), 0);

export const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'CNY'] as const;
const SYMBOL: Record<string, string> = { USD: 'US$', EUR: '€', GBP: '£', CNY: '¥', CAD: 'C$' };
/** "US$424.75" */
export const fmtCur = (cents: number, currency: string) => `${SYMBOL[currency] || currency + ' '}${((cents || 0) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Expense categories where tracking the supplier is most useful. */
export const PRODUCTION_CATEGORIES = ['Production & Manufacturing', 'Blanks & Materials', 'Samples & Development', 'Packaging & Shipping'];

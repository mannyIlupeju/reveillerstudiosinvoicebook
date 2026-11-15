import type { Invoice, Rule, Run, Txn } from './types';
import { daysBetween, dayLabel, fmt, monthLabel, monthOf, sum, today } from './format';

export const inMonth = (txns: Txn[], ym: string) => txns.filter((t) => monthOf(t.date) === ym);
export const totals = (txns: Txn[]) => {
  const inc = sum(txns.filter((t) => t.type === 'INCOME'), (t) => t.amountCents);
  const exp = sum(txns.filter((t) => t.type === 'EXPENSE'), (t) => t.amountCents);
  return { inc, exp, net: inc - exp };
};
export function spendByCat(txns: Txn[], ym: string) {
  const m: Record<string, number> = {};
  inMonth(txns, ym).filter((t) => t.type === 'EXPENSE').forEach((t) => { m[t.category] = (m[t.category] || 0) + t.amountCents; });
  return m;
}
export function invStatus(i: Invoice): 'paid' | 'void' | 'overdue' | 'open' {
  if (i.status === 'PAID') return 'paid';
  if (i.status === 'VOID') return 'void';
  return i.dueDate < today() ? 'overdue' : 'open';
}
export const isOpen = (i: Invoice) => i.status === 'OPEN';
export const monthlyEquiv = (r: Rule) => ({ weekly: (r.amountCents * 52) / 12, monthly: r.amountCents, quarterly: r.amountCents / 3, yearly: r.amountCents / 12 }[r.frequency] ?? r.amountCents);

export function runStats(run: Run, txns: Txn[]) {
  const costs = txns.filter((t) => t.type === 'EXPENSE' && t.runId === run.id);
  const total = sum(costs, (t) => t.amountCents);
  const unit = run.units ? total / run.units : 0;
  const m = (price: number | null) => (price && run.units ? (price - unit) / price : null);
  return { costs, total, unit, marginRetail: m(run.retailPriceCents), marginWholesale: m(run.wholesalePriceCents) };
}

export type Alert = { sev: 'critical' | 'warning' | 'info'; text: string; to: string };
export function alerts(invoices: Invoice[], rules: Rule[], txns: Txn[], limits: Record<string, number>, ym: string): Alert[] {
  const out: Alert[] = [];
  const t = today();
  for (const i of invoices) {
    const st = invStatus(i);
    if (st === 'overdue') {
      const d = daysBetween(i.dueDate, t);
      out.push({ sev: 'critical', to: '/invoices', text: i.kind === 'PAYABLE'
        ? `You owe ${i.party} ${fmt(i.amountCents)}, ${d} day${d === 1 ? '' : 's'} overdue.`
        : `${i.party} owes you ${fmt(i.amountCents)} on ${i.number || 'an invoice'}, ${d} day${d === 1 ? '' : 's'} overdue.` });
    } else if (st === 'open' && i.kind === 'PAYABLE' && daysBetween(t, i.dueDate) <= 7) {
      out.push({ sev: 'warning', to: '/invoices', text: `Bill from ${i.party} for ${fmt(i.amountCents)} is due ${dayLabel(i.dueDate)}.` });
    }
  }
  const spent = spendByCat(txns, ym);
  for (const [c, l] of Object.entries(limits)) {
    const s = spent[c] || 0;
    if (s > l) out.push({ sev: 'critical', to: '/budgets', text: `${c} is ${fmt(s - l)} over its ${fmt(l)} budget for ${monthLabel(ym)}.` });
    else if (s >= 0.8 * l) out.push({ sev: 'warning', to: '/budgets', text: `${c} is at ${Math.round((s / l) * 100)}% of its ${fmt(l)} budget.` });
  }
  for (const r of rules) {
    if (r.active && r.nextDue > t && daysBetween(t, r.nextDue) <= 7) out.push({ sev: 'info', to: '/recurring', text: `Coming up: ${r.party} ${fmt(r.amountCents)} on ${dayLabel(r.nextDue)}.` });
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}

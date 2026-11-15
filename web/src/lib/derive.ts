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

// A run's cost = expenses in the books tagged to it + past costs recorded on the run only.
export function runStats(run: Run, txns: Txn[]) {
  const costs = txns.filter((t) => t.type === 'EXPENSE' && t.runId === run.id);
  const history = run.historyCosts || [];
  const total = sum(costs, (t) => t.amountCents) + sum(history, (h) => h.amountCents);
  const unit = run.units ? total / run.units : 0;
  const m = (price: number | null) => (price && run.units ? (price - unit) / price : null);
  return { costs, history, total, unit, marginRetail: m(run.retailPriceCents), marginWholesale: m(run.wholesalePriceCents) };
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

export type OrderStatus = 'none' | 'quoted' | 'deposit' | 'paid';
/**
 * A run's supplier order: quote, deposit, final payment and what's left to pay.
 * Amounts are compared in the quote's currency when the payments use it, otherwise in CAD.
 */
export function runOrder(run: Run, txns: Txn[], invoices: Invoice[]) {
  const deposit = txns.find((t) => t.runId === run.id && t.runPayment === 'DEPOSIT') || null;
  const final = txns.find((t) => t.runId === run.id && t.runPayment === 'FINAL') || null;
  const openBill = invoices.find((i) => i.runId === run.id && i.kind === 'PAYABLE' && i.status === 'OPEN') || null;
  const cur = run.quotedCurrency || 'CAD';
  const inQuoteCur = (t: Txn | null) => (!t ? 0 : cur === 'CAD' ? (t.originalCurrency ? null : t.amountCents) : t.originalCurrency === cur ? t.originalAmountCents : null);
  const parts = [inQuoteCur(deposit), inQuoteCur(final)];
  const sameCur = parts.every((p) => p !== null);
  const paidQuote = sameCur ? (parts as number[]).reduce((a, b) => a + b, 0) : null;
  const paidCad = (deposit?.amountCents || 0) + (final?.amountCents || 0);
  const quote = run.quotedAmountCents;
  const balance = quote && paidQuote !== null ? Math.max(0, quote - paidQuote) : quote && run.quotedCadCents ? Math.max(0, run.quotedCadCents - paidCad) : null;
  const balanceCur = quote && paidQuote !== null ? cur : 'CAD';
  const status: OrderStatus = final || (quote && balance === 0 && paidCad > 0) ? 'paid' : deposit ? 'deposit' : quote ? 'quoted' : 'none';
  return { deposit, final, openBill, quote, quoteCur: cur, paidCad, balance, balanceCur, status };
}

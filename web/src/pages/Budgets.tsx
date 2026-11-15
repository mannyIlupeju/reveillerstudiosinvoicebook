import { useState } from 'react';
import { useMonth } from '../App';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { EXPENSE_CATEGORIES, centsInput, fmt, monthLabel, sum, toCents } from '../lib/format';
import { spendByCat } from '../lib/derive';

export default function Budgets() {
  const [month] = useMonth();
  const { user } = useAuth();
  const { txns, limits, reload } = useBooks();
  const toast = useToast();
  const editor = canEdit(user);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, limits[c] ? centsInput(limits[c]) : ''])));
  const [busy, setBusy] = useState(false);
  const spent = spendByCat(txns, month);

  const save = async () => {
    const out: Record<string, number> = {};
    for (const [c, v] of Object.entries(draft)) {
      if (!v.trim()) continue;
      const n = toCents(v);
      if (Number.isNaN(n) || n < 0) { toast(`Check the limit for ${c}.`); return; }
      if (n > 0) out[c] = n;
    }
    setBusy(true);
    try { await api('/budgets', { method: 'PUT', body: { limits: out } }); await reload(); toast('Budgets saved'); }
    catch (e: any) { toast(e.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <div><h2>Monthly budgets</h2><p>Limits apply to every month. Showing actual spend for {monthLabel(month)}.</p></div>
        {editor && <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save budgets'}</button>}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Category</th><th className="amt">Monthly limit</th><th className="amt">Spent</th><th style={{ width: '34%' }}>Progress</th></tr></thead>
          <tbody>
            {EXPENSE_CATEGORIES.map((c, i) => {
              const l = limits[c] || 0, s = spent[c] || 0, p = l ? s / l : 0, cls = l && s > l ? 'crit' : l && p >= 0.8 ? 'warn' : '';
              return (
                <tr key={c}>
                  <td>{c}</td>
                  <td className="amt"><input className="budget-in" id={`b-${i}`} inputMode="decimal" aria-label={`${c} monthly limit`} placeholder="No limit" disabled={!editor}
                    value={draft[c]} onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))} /></td>
                  <td className="amt">{fmt(s)}</td>
                  <td>{l ? <div className="cat" style={{ gridTemplateColumns: '1fr auto' }}><div className="track"><div className={`fill ${cls}`} style={{ width: `${Math.min(100, p * 100)}%` }} /></div><span className="n">{Math.round(p * 100)}%</span></div> : <span className="sub">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td><b>Total</b></td><td className="amt">{fmt(sum(Object.values(limits), (x) => x))}</td><td className="amt">{fmt(sum(Object.values(spent), (x) => x))}</td><td /></tr></tfoot>
        </table>
      </div>
    </section>
  );
}

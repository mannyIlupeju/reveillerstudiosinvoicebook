import { useState } from 'react';
import Modal from '../components/Modal';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { EXPENSE_CATEGORIES, FREQ, LINES, centsInput, dayLabel, fmt, sum, toCents, today } from '../lib/format';
import { monthlyEquiv } from '../lib/derive';
import type { Rule } from '../lib/types';

export default function Recurring() {
  const { user } = useAuth();
  const { rules, reload } = useBooks();
  const toast = useToast();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const editor = canEdit(user);
  const active = rules.filter((r) => r.active);
  const perMonth = sum(active, monthlyEquiv);

  const toggle = async (r: Rule) => {
    try { await api(`/recurring/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); await reload(); toast(r.active ? 'Paused' : 'Resumed'); }
    catch (e: any) { toast(e.message); }
  };

  return (
    <>
      <section className="tiles">
        <div className="tile"><span className="k">Monthly run rate</span><span className="v">{fmt(Math.round(perMonth))}</span><span className="s">{active.length} active charge{active.length === 1 ? '' : 's'}</span></div>
        <div className="tile"><span className="k">Per year</span><span className="v">{fmt(Math.round(perMonth * 12))}</span><span className="s">At current amounts</span></div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <div><h2>Recurring charges</h2><p>Logged automatically on their due date by the server, even if nobody opens the app.</p></div>
          {editor && <button className="btn primary" onClick={() => setEditing('new')}>+ Add recurring</button>}
        </div>
        {rules.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Vendor</th><th>Category</th><th>Frequency</th><th>Next due</th><th className="amt">Amount</th><th>Status</th>{editor && <th />}</tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.party}<span className="sub">{r.description}</span></td>
                  <td>{r.category}{r.line !== 'Shared' && <span className="chip">{r.line}</span>}</td>
                  <td>{FREQ[r.frequency]}</td>
                  <td>{r.active ? dayLabel(r.nextDue) : '—'}</td>
                  <td className="amt">{fmt(r.amountCents)}</td>
                  <td><span className={`pill ${r.active ? 'good' : ''}`}>{r.active ? 'Active' : 'Paused'}</span></td>
                  {editor && <td className="actions"><button className="btn small" onClick={() => toggle(r)}>{r.active ? 'Pause' : 'Resume'}</button><button className="btn small" onClick={() => setEditing(r)}>Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <div className="empty">No recurring charges yet. Add studio rent, Shopify, Adobe and anything else you pay on a schedule.</div>}
      </section>
      {editing && <RuleModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RuleModal({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const { reload } = useBooks();
  const toast = useToast();
  const [party, setParty] = useState(rule?.party || '');
  const [amount, setAmount] = useState(centsInput(rule?.amountCents));
  const [frequency, setFrequency] = useState<Rule['frequency']>(rule?.frequency || 'monthly');
  const [nextDue, setNextDue] = useState(rule?.nextDue || today());
  const [category, setCategory] = useState(rule?.category || 'Software & Subscriptions');
  const [line, setLine] = useState(rule?.line || 'Shared');
  const [description, setDescription] = useState(rule?.description || '');

  const save = async () => {
    const amountCents = toCents(amount);
    if (!party.trim()) throw new Error('Add a vendor name.');
    if (!(amountCents > 0)) throw new Error('Enter an amount above zero.');
    const body = { party, amountCents, frequency, nextDue, category, line, description };
    if (rule) await api(`/recurring/${rule.id}`, { method: 'PATCH', body }); else await api('/recurring', { body });
    await reload();
    toast(rule ? 'Recurring charge updated' : nextDue <= today() ? 'Added, and logged what was already due' : 'Recurring charge added');
  };
  const remove = async () => { await api(`/recurring/${rule!.id}`, { method: 'DELETE' }); await reload(); toast('Deleted. Past entries were kept.'); };

  return (
    <Modal title={rule ? 'Edit recurring charge' : 'Add recurring charge'} onClose={onClose} onSubmit={save} onDelete={rule ? remove : undefined}>
      <label>Vendor<input id="c-party" value={party} onChange={(e) => setParty(e.target.value)} placeholder="e.g. Shopify, IB (studio)" autoFocus /></label>
      <label>Amount (CAD)<input id="c-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label>Frequency<select id="c-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Rule['frequency'])}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Next charge date<input id="c-next" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></label>
      <label>Category<select id="c-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Line<select id="c-line" value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
      <label className="full">Note<input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Basic plan" /></label>
      <p className="hint full">If the next charge date is today or in the past, those charges are logged as soon as you save.</p>
    </Modal>
  );
}

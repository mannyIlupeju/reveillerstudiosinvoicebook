import { useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import TxnTable from '../components/TxnTable';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { dayLabelY, fmt, fmtCur, sum } from '../lib/format';
import type { Invoice, Run, Supplier, Txn } from '../lib/types';
import TxnModal from '../components/TxnModal';
import { RunModal } from './Runs';
import { InvoiceModal } from './Invoices';
import { runOrder } from '../lib/derive';

export default function Suppliers() {
  const { user } = useAuth();
  const { suppliers } = useBooks();
  const editor = canEdit(user);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = suppliers.filter((s) => showArchived || !s.archived);
  const active = suppliers.filter((s) => !s.archived);

  return (
    <>
      <section className="tiles">
        <div className="tile"><span className="k">Suppliers</span><span className="v">{active.length}</span><span className="s">{active.filter((s) => s.paymentCount).length} paid so far</span></div>
        <div className="tile"><span className="k">Paid to suppliers</span><span className="v">{fmt(sum(active, (s) => s.paidCents))}</span><span className="s">All time, in CAD</span></div>
        <div className="tile"><span className="k">Still owed</span><span className={`v ${sum(active, (s) => s.owedCents) ? 'neg' : ''}`}>{fmt(sum(active, (s) => s.owedCents))}</span><span className="s">On open bills</span></div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <div><h2>Suppliers</h2><p>Manufacturers and vendors you buy from. Pick a supplier on production costs, bills or runs to see what you’ve paid each one and what’s still owed.</p></div>
          {editor && <div className="row"><Link className="btn" to="/suppliers/import">Import spreadsheet</Link><button className="btn primary" onClick={() => setEditing('new')}>+ New supplier</button></div>}
        </div>
        {list.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Supplier</th><th className="hide-sm">Contact</th><th className="amt">Paid</th><th className="amt">Owed</th><th className="amt hide-sm">Runs</th><th className="hide-sm">Last paid</th>{editor && <th />}</tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="click" tabIndex={0} onClick={() => setViewing(s)} onKeyDown={(e) => e.key === 'Enter' && setViewing(s)}>
                  <td>{s.name}{s.archived && <span className="chip">archived</span>}<span className="sub">{[s.platform, s.notes].filter(Boolean).join(' · ').slice(0, 90)}</span></td>
                  <td className="hide-sm">{s.contact || '—'}</td>
                  <td className="amt">{fmt(s.paidCents)}<span className="sub">{s.paymentCount} payment{s.paymentCount === 1 ? '' : 's'}</span></td>
                  <td className={`amt ${s.owedCents ? 'neg' : ''}`}>{s.owedCents ? fmt(s.owedCents) : '—'}</td>
                  <td className="amt hide-sm">{s.runCount || '—'}</td>
                  <td className="hide-sm">{s.lastPaid ? dayLabelY(s.lastPaid) : '—'}</td>
                  {editor && <td className="actions"><button className="btn small" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <div className="empty">No suppliers yet. Add one here, import your supplier sheet, or create one from the supplier picker on any production cost.</div>}
        {suppliers.some((s) => s.archived) && <label className="row sub" style={{ gap: 6 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ minHeight: 0 }} />Show archived</label>}
      </section>
      {editing && <SupplierModal supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && <SupplierDetail supplier={suppliers.find((s) => s.id === viewing.id) || viewing} editor={editor} onEdit={() => { setEditing(viewing); setViewing(null); }} onClose={() => setViewing(null)} />}
    </>
  );
}

function SupplierDetail({ supplier: s, editor, onEdit, onClose }: { supplier: Supplier; editor: boolean; onEdit: () => void; onClose: () => void }) {
  const { txns, invoices, runs, reload } = useBooks();
  const toast = useToast();
  const [txn, setTxn] = useState<Txn | 'new' | null>(null);
  const [bill, setBill] = useState<Invoice | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const payments = txns.filter((t) => t.supplierId === s.id);
  const bills = invoices.filter((i) => i.supplierId === s.id && i.status === 'OPEN');
  const sRuns = runs.filter((r) => r.supplierId === s.id);
  const payBill = async (b: Invoice) => {
    try { await api(`/invoices/${b.id}/pay`, { body: {} }); await reload(); toast('Bill marked paid and logged as money out'); }
    catch (e: any) { toast(e.message); }
  };
  return (
    <>
      <Modal title={s.name} onClose={onClose} wide>
        <div className="full row" style={{ justifyContent: 'space-between' }}>
          <span className="hint">{[s.contact && `Contact: ${s.contact}`, s.platform, s.email, s.website].filter(Boolean).join(' · ') || 'No contact details yet.'}</span>
          {editor && <button type="button" className="btn small" onClick={onEdit}>Edit details</button>}
        </div>
        {s.notes && <p className="full" style={{ margin: 0, whiteSpace: 'pre-line' }}>{s.notes}</p>}
        <div className="full kv">
          <div><span>Paid</span><b>{fmt(s.paidCents)}</b></div>
          <div><span>Owed</span><b className={s.owedCents ? 'neg' : ''}>{fmt(s.owedCents)}</b></div>
        </div>
        {bills.length > 0 && (
          <div className="full"><span className="hint">Open bills{editor ? ' · click to edit' : ''}</span>
            <div className="lines" style={{ marginTop: 6 }}>{bills.map((b) => (
              <div key={b.id}>
                <span className={editor ? 'linkish' : ''} role={editor ? 'button' : undefined} tabIndex={editor ? 0 : undefined}
                  onClick={editor ? () => setBill(b) : undefined} onKeyDown={editor ? (e) => e.key === 'Enter' && setBill(b) : undefined}>{b.notes || b.category} · due {dayLabelY(b.dueDate)}</span>
                <span className="row" style={{ gap: 8 }}>{fmt(b.amountCents)}{b.originalCurrency && b.originalAmountCents ? ` (${fmtCur(b.originalAmountCents, b.originalCurrency)})` : ''}
                  {editor && <button type="button" className="btn small" onClick={() => payBill(b)}>Mark paid</button>}</span>
              </div>
            ))}</div>
          </div>
        )}
        {sRuns.length > 0 && (
          <div className="full"><span className="hint">Production runs{editor ? ' · click to edit the order and payments' : ''}</span>
            <div className="lines" style={{ marginTop: 6 }}>
              {sRuns.map((r) => {
                const o = runOrder(r, txns, invoices);
                return (
                  <div key={r.id}>
                    <span className={editor ? 'linkish' : ''} role={editor ? 'button' : undefined} tabIndex={editor ? 0 : undefined}
                      onClick={editor ? () => setRun(r) : undefined} onKeyDown={editor ? (e) => e.key === 'Enter' && setRun(r) : undefined}>{r.name} · {r.units} units</span>
                    <span className="row" style={{ gap: 8 }}>{o.quote ? fmtCur(o.quote, o.quoteCur) : ''}
                      {o.status !== 'none' && <span className={`pill ${o.status === 'paid' ? 'good' : o.status === 'deposit' ? 'accent' : 'warn'}`}>{o.status === 'paid' ? 'Paid in full' : o.status === 'deposit' ? `Owes ${o.balance !== null ? fmtCur(o.balance, o.balanceCur) : 'balance'}` : 'Not paid'}</span>}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="full">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="hint">Payments{editor && payments.length ? ' · click one to edit' : ''}</span>
            {editor && <button type="button" className="btn small" onClick={() => setTxn('new')}>+ Add payment</button>}
          </div>
          {payments.length ? <TxnTable rows={payments} compact onPick={editor ? setTxn : undefined} /> : <div className="empty">No payments recorded yet.</div>}
        </div>
      </Modal>
      {txn && <TxnModal txn={txn === 'new' ? null : txn} preset={{ type: 'EXPENSE', supplierId: s.id, party: s.name, category: 'Production & Manufacturing' } as Partial<Txn>} onClose={() => setTxn(null)} />}
      {bill && <InvoiceModal inv={bill} kind="PAYABLE" onClose={() => setBill(null)} onCreated={() => {}} />}
      {run && <RunModal run={run} onClose={() => setRun(null)} />}
    </>
  );
}

function SupplierModal({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { reload } = useBooks();
  const toast = useToast();
  const [f, setF] = useState({
    name: supplier?.name || '', contact: supplier?.contact || '', platform: supplier?.platform || '', email: supplier?.email || '',
    website: supplier?.website || '', notes: supplier?.notes || '', archived: supplier?.archived || false,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.name.trim()) throw new Error('Add the supplier’s name.');
    if (supplier) await api(`/suppliers/${supplier.id}`, { method: 'PATCH', body: f }); else await api('/suppliers', { body: f });
    await reload();
    toast(supplier ? 'Supplier updated' : 'Supplier added');
  };
  const remove = async () => { await api(`/suppliers/${supplier!.id}`, { method: 'DELETE' }); await reload(); toast('Supplier deleted. Their payments and bills were kept.'); };
  return (
    <Modal title={supplier ? `Edit ${supplier.name}` : 'New supplier'} onClose={onClose} onSubmit={save} onDelete={supplier ? remove : undefined}>
      <label className="full">Name<input id="s-name" value={f.name} onChange={set('name')} placeholder="e.g. Shenzhen Aung Crown Industrial Ltd." autoFocus /></label>
      <label>Contact person<input id="s-contact" value={f.contact} onChange={set('contact')} placeholder="e.g. Tracy" /></label>
      <label>Where you found them<input id="s-platform" value={f.platform} onChange={set('platform')} placeholder="e.g. Alibaba" list="platforms" /></label>
      <datalist id="platforms"><option value="Alibaba" /><option value="Local" /><option value="Instagram" /><option value="Referral" /></datalist>
      <label>Email<input id="s-email" type="email" value={f.email} onChange={set('email')} /></label>
      <label>Website or store link<input id="s-web" value={f.website} onChange={set('website')} /></label>
      <label className="full">Notes<textarea id="s-notes" value={f.notes} onChange={set('notes')} placeholder="MOQs, lead times, what they’re good at…" /></label>
      {supplier && <label className="full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} style={{ minHeight: 0 }} />Archived (hidden from pickers, history kept)</label>}
    </Modal>
  );
}

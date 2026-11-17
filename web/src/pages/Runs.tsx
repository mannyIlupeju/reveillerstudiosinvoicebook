import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Modal from '../components/Modal';
import TxnModal from '../components/TxnModal';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { CURRENCIES, LINES, RUN_STATUSES, STATUS_PILL, centsInput, dayLabelY, fmt, fmtCur, sum, toCents, today } from '../lib/format';
import { runOrder, runStats, type OrderStatus } from '../lib/derive';
import { SupplierSelect } from '../components/SupplierFields';
import type { Run, Txn } from '../lib/types';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const ORDER_PILL: Record<OrderStatus, [string, string]> = { none: ['', ''], quoted: ['warn', 'Not paid'], deposit: ['accent', 'Deposit paid'], paid: ['good', 'Paid in full'] };
// A payment shown in the currency it was made in, e.g. "US$424.75".
const paidAs = (t: Txn) => (t.originalCurrency && t.originalAmountCents ? fmtCur(t.originalAmountCents, t.originalCurrency) : fmt(t.amountCents));

export default function Runs() {
  const { user } = useAuth();
  const { runs, txns, invoices, suppliers } = useBooks();
  const [editing, setEditing] = useState<Run | 'new' | null>(null);
  const [costFor, setCostFor] = useState<Run | null>(null);
  const [params] = useSearchParams();
  const [supplierFilter, setSupplierFilter] = useState(params.get('supplier') || 'all');
  const [statusFilter, setStatusFilter] = useState(params.get('status') || 'all');
  const [payFilter, setPayFilter] = useState<'all' | 'owing'>('all');
  const editor = canEdit(user);
  const usedSuppliers = suppliers.filter((s) => runs.some((r) => r.supplierId === s.id));

  const orders = runs.map((r) => runOrder(r, txns, invoices));
  const owing = orders.filter((o) => o.owed && o.owed > 0);
  const owingCad = sum(owing, (o) => o.owedCad || 0);
  const unknownCad = owing.some((o) => o.owedCad === null);
  const shown = runs.filter((r) => (statusFilter === 'all' || (statusFilter === 'active' ? r.status !== 'Closed' : r.status === statusFilter))
    && (supplierFilter === 'all' || (supplierFilter === 'none' ? !r.supplierId : r.supplierId === supplierFilter))
    && (payFilter === 'all' || ['quoted', 'deposit'].includes(runOrder(r, txns, invoices).status)));

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div><h2>Production runs</h2><p>Track each run’s supplier order: the quote, deposit and final payment. Cost is everything tagged to the run plus past costs; unit cost is marked “est.” while the quote isn’t fully paid.</p></div>
          {editor && <div className="row"><Link className="btn" to="/production/import">Import spreadsheet</Link><button className="btn primary" onClick={() => setEditing('new')}>+ New run</button></div>}
        </div>
        {runs.length > 0 && (
          <div className="filters">
            <select aria-label="Supplier" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="all">All suppliers</option>
              {usedSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="none">No supplier</option>
            </select>
            <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Not closed</option>
              {RUN_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
            <select aria-label="Payment" value={payFilter} onChange={(e) => setPayFilter(e.target.value as 'all')}>
              <option value="all">All payment states</option>
              <option value="owing">Still owing the supplier</option>
            </select>
          </div>
        )}
      </section>
      {runs.length > 0 && (
        <section className="tiles">
          <div className="tile"><span className="k">Owed to suppliers</span><span className={`v ${owingCad ? 'neg' : ''}`}>{fmt(owingCad)}{unknownCad ? '+' : ''}</span>
            <span className="s">{owing.length ? `On ${owing.length} run${owing.length === 1 ? '' : 's'}, in CAD (est.)` : 'All runs paid up'}</span></div>
          <div className="tile"><span className="k">Paid on run orders</span><span className="v">{fmt(sum(orders, (o) => o.paidCad))}</span><span className="s">Deposits and final payments</span></div>
          <div className="tile"><span className="k">Runs</span><span className="v">{runs.length}</span><span className="s">{orders.filter((o) => o.status === 'paid').length} paid in full · {owing.length} owing</span></div>
        </section>
      )}
      {!runs.length ? (
        <div className="welcome"><h2>No production runs yet</h2><p>Create a run for each drop or style batch, for example “RVS Drop 03 hoodies, 60 units”. Then add the supplier’s quote and payments, and tag other costs like labels and freight, to see your real unit cost and margin.</p>
          {editor && <div className="row"><Link className="btn" to="/production/import">Import past runs from a spreadsheet</Link></div>}</div>
      ) : !shown.length ? (
        <div className="empty">No runs match these filters.</div>
      ) : (
        <section className="runs">
          {shown.map((r) => {
            const s = runStats(r, txns);
            const o = runOrder(r, txns, invoices);
            const supplier = suppliers.find((x) => x.id === r.supplierId);
            // While the quote isn't fully paid, project the cost from the quote so unit cost isn't understated.
            const estimating = o.status !== 'paid' && !!r.quotedCadCents;
            const projected = estimating ? s.total - o.paidCad + Math.max(r.quotedCadCents || 0, o.paidCad) : s.total;
            const unit = r.units ? projected / r.units : 0;
            const m = (price: number | null) => (price && r.units ? (price - unit) / price : null);
            const other = s.costs.filter((t) => !t.runPayment);
            return (
              <article className="run" key={r.id}>
                <div>
                  <h3>{r.name}</h3>
                  <div className="meta"><span className="chip">{r.line}</span><span>{dayLabelY(r.date)}</span><span>{r.units} units</span>
                    <span className={`pill ${STATUS_PILL[r.status] ?? ''}`}>{r.status}</span></div>
                </div>

                {o.owed !== null && o.owed > 0 ? (
                  <div className="owing due">
                    <span className="k">Owing{supplier ? ` to ${supplier.name}` : ''}</span>
                    <b>{fmtCur(o.owed, o.owedCur)}</b>
                    <span className="s">{[o.owedCur !== 'CAD' && o.owedCad ? `≈ ${fmt(o.owedCad)} CAD` : '', o.deposit ? `deposit paid ${dayLabelY(o.deposit.date)}` : 'nothing paid yet', o.openBill ? `bill due ${dayLabelY(o.openBill.dueDate)}` : ''].filter(Boolean).join(' · ')}</span>
                  </div>
                ) : o.status === 'paid' ? (
                  <div className="owing clear"><span className="k">Paid in full</span><b>{fmt(o.paidCad)}</b><span className="s">{o.final ? `final payment ${dayLabelY(o.final.date)}` : 'nothing owing'}</span></div>
                ) : (o.deposit || supplier) && !o.quote ? (
                  <div className="owing unknown"><span className="k">Amount owing unknown</span><span className="s">Add the bulk quote in Edit run & payments to track the balance.</span></div>
                ) : null}

                {(supplier || o.quote || o.deposit || o.final) && (
                  <div className="order">
                    <div className="order-h">
                      <span><b>{supplier?.name || 'Supplier order'}</b>{supplier?.contact && <span className="sub">{supplier.contact}{supplier.platform ? ` · ${supplier.platform}` : ''}</span>}</span>
                      {o.status !== 'none' && <span className={`pill ${ORDER_PILL[o.status][0]}`}>{ORDER_PILL[o.status][1]}</span>}
                    </div>
                    <div className="lines">
                      <div><span>Bulk quote</span><span>{o.quote ? fmtCur(o.quote, o.quoteCur) : '—'}</span></div>
                      <div><span>Deposit{o.deposit && ` · ${dayLabelY(o.deposit.date)}`}</span><span>{o.deposit ? paidAs(o.deposit) : '—'}</span></div>
                      <div><span>Final payment{o.final && ` · ${dayLabelY(o.final.date)}`}</span><span>{o.final ? paidAs(o.final) : '—'}</span></div>
                    </div>
                  </div>
                )}

                <div className="kv">
                  <div><span>Total cost{estimating ? ' (est.)' : ''}</span><b>{fmt(Math.round(projected))}</b></div>
                  <div><span>Unit cost{estimating ? ' (est.)' : ''}</span><b>{r.units ? fmt(Math.round(unit)) : '—'}</b></div>
                  <div><span>Retail {r.retailPriceCents ? fmt(r.retailPriceCents) : ''}</span><b className={m(r.retailPriceCents) !== null && m(r.retailPriceCents)! < 0.5 ? 'neg' : ''}>{pct(m(r.retailPriceCents))} margin</b></div>
                  <div><span>Wholesale {r.wholesalePriceCents ? fmt(r.wholesalePriceCents) : ''}</span><b>{pct(m(r.wholesalePriceCents))} margin</b></div>
                </div>
                {other.length + s.history.length > 0 && (() => {
                  const lines = [
                    ...s.history.map((h) => ({ id: h.id, label: h.party || h.description || h.category, note: h.party ? h.description : '', cents: h.amountCents, past: true })),
                    ...other.map((t) => ({ id: t.id, label: t.party || t.category, note: t.description, cents: t.amountCents, past: false })),
                  ];
                  return (
                    <div className="lines">
                      <span className="sub">Other costs</span>
                      {lines.slice(0, 5).map((l) => <div key={l.id}><span>{l.label}{l.note ? ` · ${l.note}` : ''}{l.past && <span className="chip" title="Recorded on the run only, not in your books">past</span>}</span><span>{fmt(l.cents)}</span></div>)}
                      {lines.length > 5 && <div className="sub">+{lines.length - 5} more</div>}
                    </div>
                  );
                })()}
                {r.notes && <p className="sub" style={{ margin: 0 }}>{r.notes}</p>}
                {editor && <div className="row"><button className="btn small" onClick={() => setEditing(r)}>Edit run & payments</button><button className="btn small" onClick={() => setCostFor(r)}>+ Other cost</button></div>}
              </article>
            );
          })}
        </section>
      )}
      {editing && <RunModal run={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {costFor && <TxnModal preset={{ type: 'EXPENSE', runId: costFor.id, supplierId: costFor.supplierId, category: 'Production & Manufacturing', line: costFor.line } as Partial<Txn>} onClose={() => setCostFor(null)} />}
    </>
  );
}

type PayDraft = { amount: string; date: string; cad: string };
const payDraft = (t: Txn | null, cur: string): PayDraft => ({
  amount: t ? centsInput(cur === 'CAD' ? (t.originalCurrency ? null : t.amountCents) : t.originalCurrency === cur ? t.originalAmountCents : null) : '',
  date: t?.date || '',
  cad: t && cur !== 'CAD' ? centsInput(t.amountCents) : '',
});

export function RunModal({ run, onClose }: { run: Run | null; onClose: () => void }) {
  const { txns, invoices, reload } = useBooks();
  const toast = useToast();
  const order = run ? runOrder(run, txns, invoices) : null;
  const [name, setName] = useState(run?.name || '');
  const [line, setLine] = useState(run?.line || 'RVS');
  const [status, setStatus] = useState(run?.status || 'Open');
  const [units, setUnits] = useState(run ? String(run.units) : '');
  const [date, setDate] = useState(run?.date || today());
  const [retail, setRetail] = useState(centsInput(run?.retailPriceCents));
  const [wholesale, setWholesale] = useState(centsInput(run?.wholesalePriceCents));
  const [supplierId, setSupplierId] = useState(run?.supplierId || '');
  const [currency, setCurrency] = useState(run?.quotedCurrency || 'CAD');
  const [quote, setQuote] = useState(centsInput(run?.quotedAmountCents));
  const [dep, setDep] = useState<PayDraft>(payDraft(order?.deposit || null, run?.quotedCurrency || 'CAD'));
  const [fin, setFin] = useState<PayDraft>(payDraft(order?.final || null, run?.quotedCurrency || 'CAD'));
  const foreign = currency !== 'CAD';

  const quoteC = toCents(quote), depC = toCents(dep.amount), finC = toCents(fin.amount);
  const left = quoteC > 0 ? quoteC - (depC > 0 ? depC : 0) - (finC > 0 ? finC : 0) : null;
  const markComplete = () => setFin({ amount: centsInput(Math.max(0, quoteC - (depC > 0 ? depC : 0))), date: fin.date || today(), cad: '' });

  const save = async () => {
    const u = Math.round(Number(units));
    if (!name.trim()) throw new Error('Give the run a name.');
    if (!(u > 0)) throw new Error('Enter how many units were produced.');
    const price = (v: string) => (v.trim() ? toCents(v) : null);
    const r = price(retail), w = price(wholesale), qc = price(quote);
    if ([r, w, qc].some((x) => Number.isNaN(x))) throw new Error('Check the prices and quote.');
    for (const [label, p] of [['deposit', dep], ['final payment', fin]] as const) {
      if (p.amount.trim() && !(toCents(p.amount) > 0)) throw new Error(`Check the ${label} amount.`);
      if (p.amount.trim() && !p.date) throw new Error(`Add the date of the ${label}.`);
    }
    const body = { name, line, status, units: u, date, retailPriceCents: r, wholesalePriceCents: w, supplierId: supplierId || null, quotedAmountCents: qc, quotedCurrency: currency };
    const saved = run ? await api<{ run: Run }>(`/runs/${run.id}`, { method: 'PATCH', body }) : await api<{ run: Run }>('/runs', { body });
    const id = saved.run.id;

    // Save the deposit and final payment only when they changed.
    const prev = { DEPOSIT: payDraft(order?.deposit || null, currency), FINAL: payDraft(order?.final || null, currency) };
    for (const [kind, p] of [['DEPOSIT', dep], ['FINAL', fin]] as const) {
      const before = prev[kind];
      const changed = p.amount !== before.amount || p.date !== before.date || (foreign && p.cad !== before.cad) || (run && run.quotedCurrency !== currency);
      if (!changed) continue;
      if (!p.amount.trim()) {
        if (kind === 'DEPOSIT' ? order?.deposit : order?.final) await api(`/runs/${id}/payments/${kind.toLowerCase()}`, { method: 'DELETE' });
        continue;
      }
      const cad = foreign && p.cad.trim() && p.cad !== before.cad ? toCents(p.cad) : null;
      await api(`/runs/${id}/payments/${kind.toLowerCase()}`, { method: 'PUT', body: { amountCents: toCents(p.amount), currency, date: p.date, cadCents: cad && cad > 0 ? cad : null } });
    }
    await reload();
    toast(run ? 'Run updated' : 'Run created');
  };
  const remove = async () => { await api(`/runs/${run!.id}`, { method: 'DELETE' }); await reload(); toast('Run deleted'); };
  const removeHistory = async (costId: string) => {
    try { await api(`/runs/${run!.id}/history-costs/${costId}`, { method: 'DELETE' }); await reload(); toast('Past cost removed'); }
    catch (e: any) { toast(e.message); }
  };

  const payRow = (label: string, p: PayDraft, set: (p: PayDraft) => void, idp: string) => (
    <>
      <label>{label} ({currency})<input id={`${idp}-amt`} inputMode="decimal" value={p.amount} onChange={(e) => set({ ...p, amount: e.target.value, cad: '' })} placeholder="Not paid yet" /></label>
      <label>{label} date<input id={`${idp}-date`} type="date" value={p.date} onChange={(e) => set({ ...p, date: e.target.value, cad: '' })} /></label>
      {foreign && p.amount.trim() && (
        <label className="full">{label} in CAD (optional)
          <input id={`${idp}-cad`} inputMode="decimal" value={p.cad} onChange={(e) => set({ ...p, cad: e.target.value })} placeholder="Leave empty to use the Bank of Canada rate for the date" />
        </label>
      )}
    </>
  );

  return (
    <Modal wide title={run ? 'Edit production run' : 'New production run'} onClose={onClose} onSubmit={save} onDelete={run ? remove : undefined}>
      <label className="full">Run name<input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RVS Drop 03 hoodies" autoFocus /></label>
      <label>Line<select id="r-line" value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
      <label>Status<select id="r-status" value={status} onChange={(e) => setStatus(e.target.value)}>{RUN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Units produced<input id="r-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} /></label>
      <label>Start date<input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Retail price (CAD)<input id="r-retail" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="Optional" /></label>
      <label>Wholesale price (CAD)<input id="r-wholesale" inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} placeholder="Optional" /></label>

      <div className="full section-h"><h3>Supplier order</h3><span className="hint">Payments are added to your books as expenses for this run.</span></div>
      <SupplierSelect value={supplierId} onChange={(id) => setSupplierId(id)} id="r-supplier" />
      <label>Order currency<select id="r-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Bulk production cost (quote)<input id="r-quote" inputMode="decimal" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Total quoted, incl. shipping" /></label>
      <div className="row" style={{ alignSelf: 'end', minHeight: 36 }}>
        {left !== null && (left > 0
          ? <><span className="sub">Left to pay <b className="neg">{fmtCur(left, currency)}</b></span><button type="button" className="btn small" onClick={markComplete}>Mark paid in full</button></>
          : <span className="pill good">Paid in full</span>)}
      </div>
      {payRow('Deposit', dep, setDep, 'r-dep')}
      {payRow('Final payment', fin, setFin, 'r-fin')}
      {order?.openBill && !order.final && <p className="hint full">There’s an open bill of {order.openBill.originalCurrency && order.openBill.originalAmountCents ? fmtCur(order.openBill.originalAmountCents, order.openBill.originalCurrency) : fmt(order.openBill.amountCents)} for this run. Recording the final payment marks it paid.</p>}

      {run && run.historyCosts.length > 0 && (
        <div className="full">
          <span className="hint">Past costs recorded on this run only (not in your books)</span>
          <div className="lines" style={{ marginTop: 6 }}>
            {run.historyCosts.map((h) => (
              <div key={h.id}><span>{[h.party, h.description].filter(Boolean).join(' · ') || h.category}{h.date ? ` · ${h.date}` : ''}</span>
                <span className="row" style={{ gap: 6 }}>{fmt(h.amountCents)}<button type="button" className="btn small" aria-label="Remove past cost" onClick={() => removeHistory(h.id)}>×</button></span></div>
            ))}
          </div>
        </div>
      )}
      {run && <p className="hint full">Deleting a run keeps its book entries, including deposits and final payments; they just stop being tagged to it.</p>}
    </Modal>
  );
}

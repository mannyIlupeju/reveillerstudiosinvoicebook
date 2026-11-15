import { useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import TxnModal from '../components/TxnModal';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { LINES, RUN_STATUSES, centsInput, dayLabelY, fmt, toCents, today } from '../lib/format';
import { runStats } from '../lib/derive';
import { SupplierSelect } from '../components/SupplierFields';
import type { Run, Txn } from '../lib/types';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default function Runs() {
  const { user } = useAuth();
  const { runs, txns, suppliers } = useBooks();
  const [editing, setEditing] = useState<Run | 'new' | null>(null);
  const [costFor, setCostFor] = useState<Run | null>(null);
  const editor = canEdit(user);

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div><h2>Production runs</h2><p>Each run’s cost is the expenses tagged to it plus any past costs imported onto it (marked “past”). Unit cost is that total divided by units produced.</p></div>
          {editor && <div className="row"><Link className="btn" to="/production/import">Import spreadsheet</Link><button className="btn primary" onClick={() => setEditing('new')}>+ New run</button></div>}
        </div>
      </section>
      {!runs.length ? (
        <div className="welcome"><h2>No production runs yet</h2><p>Create a run for each drop or style batch, for example “RVS Drop 03 hoodies, 60 units”. Then tag the blanks, printing, labels and freight to it to see your real unit cost and margin.</p>
          {editor && <div className="row"><Link className="btn" to="/production/import">Import past runs from a spreadsheet</Link></div>}</div>
      ) : (
        <section className="runs">
          {runs.map((r) => {
            const s = runStats(r, txns);
            return (
              <article className="run" key={r.id}>
                <div>
                  <h3>{r.name}</h3>
                  <div className="meta"><span className="chip">{r.line}</span>{r.supplierId && <span>{suppliers.find((x) => x.id === r.supplierId)?.name}</span>}<span>{dayLabelY(r.date)}</span><span>{r.units} units</span>
                    <span className={`pill ${r.status === 'Selling' ? 'good' : r.status === 'In production' ? 'accent' : ''}`}>{r.status}</span></div>
                </div>
                <div className="kv">
                  <div><span>Total cost</span><b>{fmt(s.total)}</b></div>
                  <div><span>Unit cost</span><b>{fmt(Math.round(s.unit))}</b></div>
                  <div><span>Retail {r.retailPriceCents ? fmt(r.retailPriceCents) : ''}</span><b className={s.marginRetail !== null && s.marginRetail < 0.5 ? 'neg' : ''}>{pct(s.marginRetail)} margin</b></div>
                  <div><span>Wholesale {r.wholesalePriceCents ? fmt(r.wholesalePriceCents) : ''}</span><b>{pct(s.marginWholesale)} margin</b></div>
                </div>
                {s.costs.length + s.history.length ? (() => {
                  const lines = [
                    ...s.history.map((h) => ({ id: h.id, label: h.party || h.description || h.category, note: h.party ? h.description : '', cents: h.amountCents, past: true })),
                    ...s.costs.map((t) => ({ id: t.id, label: t.party || t.category, note: t.description, cents: t.amountCents, past: false })),
                  ];
                  return (
                    <div className="lines">
                      {lines.slice(0, 6).map((l) => <div key={l.id}><span>{l.label}{l.note ? ` · ${l.note}` : ''}{l.past && <span className="chip" title="Recorded on the run only, not in your books">past</span>}</span><span>{fmt(l.cents)}</span></div>)}
                      {lines.length > 6 && <div className="sub">+{lines.length - 6} more</div>}
                    </div>
                  );
                })() : <p className="sub" style={{ margin: 0 }}>No costs tagged yet.</p>}
                {r.notes && <p className="sub" style={{ margin: 0 }}>{r.notes}</p>}
                {editor && <div className="row"><button className="btn small" onClick={() => setCostFor(r)}>+ Add cost</button><button className="btn small" onClick={() => setEditing(r)}>Edit run</button></div>}
              </article>
            );
          })}
        </section>
      )}
      {editing && <RunModal run={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {costFor && <TxnModal preset={{ type: 'EXPENSE', runId: costFor.id, category: 'Production & Manufacturing', line: costFor.line } as Partial<Txn>} onClose={() => setCostFor(null)} />}
    </>
  );
}

function RunModal({ run, onClose }: { run: Run | null; onClose: () => void }) {
  const { reload } = useBooks();
  const toast = useToast();
  const [name, setName] = useState(run?.name || '');
  const [line, setLine] = useState(run?.line || 'RVS');
  const [status, setStatus] = useState(run?.status || 'Planning');
  const [units, setUnits] = useState(run ? String(run.units) : '');
  const [date, setDate] = useState(run?.date || today());
  const [retail, setRetail] = useState(centsInput(run?.retailPriceCents));
  const [wholesale, setWholesale] = useState(centsInput(run?.wholesalePriceCents));
  const [supplierId, setSupplierId] = useState(run?.supplierId || '');

  const save = async () => {
    const u = Math.round(Number(units));
    if (!name.trim()) throw new Error('Give the run a name.');
    if (!(u > 0)) throw new Error('Enter how many units were produced.');
    const price = (v: string) => (v.trim() ? toCents(v) : null);
    const r = price(retail), w = price(wholesale);
    if (Number.isNaN(r) || Number.isNaN(w)) throw new Error('Check the prices.');
    const body = { name, line, status, units: u, date, retailPriceCents: r, wholesalePriceCents: w, supplierId: supplierId || null };
    if (run) await api(`/runs/${run.id}`, { method: 'PATCH', body }); else await api('/runs', { body });
    await reload();
    toast(run ? 'Run updated' : 'Run created');
  };
  const remove = async () => { await api(`/runs/${run!.id}`, { method: 'DELETE' }); await reload(); toast('Run deleted'); };
  const removeHistory = async (costId: string) => {
    try { await api(`/runs/${run!.id}/history-costs/${costId}`, { method: 'DELETE' }); await reload(); toast('Past cost removed'); }
    catch (e: any) { toast(e.message); }
  };

  return (
    <Modal title={run ? 'Edit production run' : 'New production run'} onClose={onClose} onSubmit={save} onDelete={run ? remove : undefined}>
      <label className="full">Run name<input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RVS Drop 03 hoodies" autoFocus /></label>
      <label>Line<select id="r-line" value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
      <label>Status<select id="r-status" value={status} onChange={(e) => setStatus(e.target.value)}>{RUN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
 <SupplierSelect value={supplierId} onChange={(id) => setSupplierId(id)} id="r-supplier" />
      <label>Units produced<input id="r-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} /></label>
      <label>Start date<input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Retail price<input id="r-retail" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="Optional" /></label>
      <label>Wholesale price<input id="r-wholesale" inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} placeholder="Optional" /></label>
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
      {run && <p className="hint full">Deleting a run keeps its book entries; they just stop being tagged to it. Past costs recorded on the run are deleted with it.</p>}
    </Modal>
  );
}

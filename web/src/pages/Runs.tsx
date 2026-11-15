import { useState } from 'react';
import Modal from '../components/Modal';
import TxnModal from '../components/TxnModal';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { LINES, RUN_STATUSES, centsInput, dayLabel, fmt, toCents, today } from '../lib/format';
import { runStats } from '../lib/derive';
import type { Run, Txn } from '../lib/types';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default function Runs() {
  const { user } = useAuth();
  const { runs, txns } = useBooks();
  const [editing, setEditing] = useState<Run | 'new' | null>(null);
  const [costFor, setCostFor] = useState<Run | null>(null);
  const editor = canEdit(user);

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div><h2>Production runs</h2><p>Each run’s cost is the total of the expenses tagged to it. Unit cost is that total divided by units produced.</p></div>
          {editor && <button className="btn primary" onClick={() => setEditing('new')}>+ New run</button>}
        </div>
      </section>
      {!runs.length ? (
        <div className="welcome"><h2>No production runs yet</h2><p>Create a run for each drop or style batch, for example “RVS Drop 03 hoodies, 60 units”. Then tag the blanks, printing, labels and freight to it to see your real unit cost and margin.</p></div>
      ) : (
        <section className="runs">
          {runs.map((r) => {
            const s = runStats(r, txns);
            return (
              <article className="run" key={r.id}>
                <div>
                  <h3>{r.name}</h3>
                  <div className="meta"><span className="chip">{r.line}</span><span>{dayLabel(r.date)}</span><span>{r.units} units</span>
                    <span className={`pill ${r.status === 'Selling' ? 'good' : r.status === 'In production' ? 'accent' : ''}`}>{r.status}</span></div>
                </div>
                <div className="kv">
                  <div><span>Total cost</span><b>{fmt(s.total)}</b></div>
                  <div><span>Unit cost</span><b>{fmt(Math.round(s.unit))}</b></div>
                  <div><span>Retail {r.retailPriceCents ? fmt(r.retailPriceCents) : ''}</span><b className={s.marginRetail !== null && s.marginRetail < 0.5 ? 'neg' : ''}>{pct(s.marginRetail)} margin</b></div>
                  <div><span>Wholesale {r.wholesalePriceCents ? fmt(r.wholesalePriceCents) : ''}</span><b>{pct(s.marginWholesale)} margin</b></div>
                </div>
                {s.costs.length ? (
                  <div className="lines">
                    {s.costs.slice(0, 6).map((t) => <div key={t.id}><span>{t.party || t.category}{t.description ? ` · ${t.description}` : ''}</span><span>{fmt(t.amountCents)}</span></div>)}
                    {s.costs.length > 6 && <div className="sub">+{s.costs.length - 6} more</div>}
                  </div>
                ) : <p className="sub" style={{ margin: 0 }}>No costs tagged yet.</p>}
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

  const save = async () => {
    const u = Math.round(Number(units));
    if (!name.trim()) throw new Error('Give the run a name.');
    if (!(u > 0)) throw new Error('Enter how many units were produced.');
    const price = (v: string) => (v.trim() ? toCents(v) : null);
    const r = price(retail), w = price(wholesale);
    if (Number.isNaN(r) || Number.isNaN(w)) throw new Error('Check the prices.');
    const body = { name, line, status, units: u, date, retailPriceCents: r, wholesalePriceCents: w };
    if (run) await api(`/runs/${run.id}`, { method: 'PATCH', body }); else await api('/runs', { body });
    await reload();
    toast(run ? 'Run updated' : 'Run created');
  };
  const remove = async () => { await api(`/runs/${run!.id}`, { method: 'DELETE' }); await reload(); toast('Run deleted'); };

  return (
    <Modal title={run ? 'Edit production run' : 'New production run'} onClose={onClose} onSubmit={save} onDelete={run ? remove : undefined}>
      <label className="full">Run name<input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RVS Drop 03 hoodies" autoFocus /></label>
      <label>Line<select id="r-line" value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
      <label>Status<select id="r-status" value={status} onChange={(e) => setStatus(e.target.value)}>{RUN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Units produced<input id="r-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} /></label>
      <label>Start date<input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Retail price<input id="r-retail" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="Optional" /></label>
      <label>Wholesale price<input id="r-wholesale" inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} placeholder="Optional" /></label>
      {run && <p className="hint full">Deleting a run keeps its cost entries; they just stop being tagged to it.</p>}
    </Modal>
  );
}

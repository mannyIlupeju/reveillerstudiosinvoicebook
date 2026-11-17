import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { runOrder } from '../lib/derive';
import { RUN_STATUSES, STATUS_PILL, dayLabelY, fmt, fmtCur } from '../lib/format';
import { RunModal } from '../pages/Runs';
import type { Run } from '../lib/types';

/** Dashboard section: production projects grouped by supplier, with a status for each. */
export default function ProductionBoard() {
  const { user } = useAuth();
  const { runs, suppliers, txns, invoices, reload } = useBooks();
  const toast = useToast();
  const editor = canEdit(user);
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<Run | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const counts = Object.fromEntries(RUN_STATUSES.map((s) => [s, runs.filter((r) => r.status === s).length]));
  const visible = runs.filter((r) => showClosed || r.status !== 'Closed');

  // One group per supplier, plus runs with no supplier at the end. Groups with active work come first.
  const groups = [...suppliers.map((s) => ({ id: s.id, name: s.name, runs: visible.filter((r) => r.supplierId === s.id) })),
    { id: 'none', name: 'No supplier', runs: visible.filter((r) => !r.supplierId) }]
    .filter((g) => g.runs.length)
    .map((g) => ({ ...g, active: g.runs.filter((r) => r.status !== 'Closed').length }))
    .sort((a, b) => (a.id === 'none' ? 1 : b.id === 'none' ? -1 : b.active - a.active || a.name.localeCompare(b.name)));

  const setStatus = async (run: Run, status: string) => {
    setSaving(run.id);
    try {
      await api(`/runs/${run.id}`, { method: 'PATCH', body: { status } });
      await reload();
      toast(`${run.name} is now ${status.toLowerCase()}`);
    } catch (e: any) { toast(e.message); } finally { setSaving(null); }
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <div><h2>Production</h2><p>Projects with each supplier. {showClosed ? 'Showing all projects.' : 'Closed projects are hidden.'}</p></div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed</label>
          <Link to="/production">All runs</Link>
        </div>
      </div>
      <div className="status-counts">
        {RUN_STATUSES.map((s) => (
          <Link key={s} to={`/production?status=${encodeURIComponent(s)}`} className="status-count">
            <span className={`pill ${STATUS_PILL[s]}`}>{s}</span><b>{counts[s]}</b>
          </Link>
        ))}
      </div>
      {!runs.length ? (
        <div className="empty">No production runs yet. <Link to="/production">Add one</Link> or import your supplier sheet from Suppliers.</div>
      ) : !groups.length ? (
        <div className="empty">Every project is closed. Tick “Show closed” to see them.</div>
      ) : (
        <div className="prod-groups">
          {groups.map((g) => (
            <div className="prod-group" key={g.id}>
              <div className="prod-group-h">
                {g.id === 'none' ? <h3>{g.name}</h3> : <h3><Link to={`/production?supplier=${g.id}`}>{g.name}</Link></h3>}
                <span className="muted">{g.active} ongoing{g.runs.length > g.active ? ` · ${g.runs.length - g.active} closed` : ''}</span>
              </div>
              <ul className="prod-list">
                {g.runs.map((r) => {
                  const o = runOrder(r, txns, invoices);
                  return (
                    <li key={r.id}>
                      <button className="linkish prod-name" onClick={() => setEditing(r)}>{r.name}</button>
                      <span className="prod-meta">{dayLabelY(r.date)} · {r.units} units</span>
                      <span className="prod-owed">
                        {o.owed && o.owed > 0 ? <span className="neg">Owes {fmtCur(o.owed, o.owedCur)}</span>
                          : o.status === 'paid' ? <span className="muted">Paid {fmt(o.paidCad)}</span> : <span className="muted">No quote</span>}
                      </span>
                      {editor ? (
                        <select className={`status-select ${STATUS_PILL[r.status] ?? ''}`} aria-label={`Status of ${r.name}`} value={r.status}
                          disabled={saving === r.id} onChange={(e) => setStatus(r, e.target.value)}>
                          {RUN_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      ) : <span className={`pill ${STATUS_PILL[r.status] ?? ''}`}>{r.status}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {editing && <RunModal run={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

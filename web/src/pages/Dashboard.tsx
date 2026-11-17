import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMonth } from '../App';
import { canEdit, useAuth, useBooks } from '../lib/store';
import { alerts, inMonth, invStatus, spendByCat, totals } from '../lib/derive';
import { fmt, fmtK, monthLabel, shiftMonth, sum } from '../lib/format';
import TxnTable from '../components/TxnTable';
import TxnModal from '../components/TxnModal';
import ProductionBoard from '../components/ProductionBoard';
import type { Txn } from '../lib/types';

export default function Dashboard({ onAdd }: { onAdd: () => void }) {
  const [month] = useMonth();
  const { user } = useAuth();
  const { txns, invoices, rules, limits } = useBooks();
  const [editing, setEditing] = useState<Txn | null>(null);
  const cur = totals(inMonth(txns, month));
  const prev = totals(inMonth(txns, shiftMonth(month, -1)));
  const openR = invoices.filter((i) => i.kind === 'RECEIVABLE' && i.status === 'OPEN');
  const openP = invoices.filter((i) => i.kind === 'PAYABLE' && i.status === 'OPEN');
  const al = alerts(invoices, rules, txns, limits, month);
  const delta = prev.exp ? Math.round(((cur.exp - prev.exp) / prev.exp) * 100) : null;
  const recent = txns.slice(0, 8);

  return (
    <>
      {!txns.length && (
        <section className="welcome">
          <h2>Start your books</h2>
          <p>Nothing logged yet. Add an expense or a sale, set up recurring charges like studio rent and Shopify, import a bank CSV, or create a production run to track unit costs.</p>
          {canEdit(user) && (
            <div className="row">
              <button className="btn primary" onClick={onAdd}>Add first entry</button>
              <Link className="btn" to="/import">Import a CSV</Link>
              <Link className="btn" to="/recurring">Set up recurring</Link>
            </div>
          )}
        </section>
      )}
      {al.length > 0 && (
        <section className="alerts" aria-label="Alerts">
          {al.map((a, k) => (
            <Link key={k} to={a.to} className={`alert ${a.sev}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className={`pill ${a.sev === 'critical' ? 'crit' : a.sev === 'warning' ? 'warn' : ''}`}>{a.sev === 'critical' ? 'Action' : a.sev === 'warning' ? 'Watch' : 'Upcoming'}</span>
              <span>{a.text}</span>
            </Link>
          ))}
        </section>
      )}
      <section className="tiles">
        <div className="tile"><span className="k">Money in</span><span className="v pos">{fmt(cur.inc)}</span><span className="s">{monthLabel(month)}</span></div>
        <div className="tile"><span className="k">Money out</span><span className="v">{fmt(cur.exp)}</span><span className="s">{delta === null ? 'No spend last month' : `${delta >= 0 ? 'Up' : 'Down'} ${Math.abs(delta)}% vs last month`}</span></div>
        <div className="tile"><span className="k">Net</span><span className={`v ${cur.net >= 0 ? 'pos' : 'neg'}`}>{fmt(cur.net)}</span><span className="s">{cur.net >= 0 ? 'Profit' : 'Loss'} this month</span></div>
        <div className="tile"><span className="k">Owed to you</span><span className="v">{fmt(sum(openR, (i) => i.amountCents))}</span><span className="s">{openR.length} open · {openR.filter((i) => invStatus(i) === 'overdue').length} overdue</span></div>
        <div className="tile"><span className="k">You owe</span><span className="v">{fmt(sum(openP, (i) => i.amountCents))}</span><span className="s">{openP.length} open bill{openP.length === 1 ? '' : 's'}</span></div>
      </section>
      <ProductionBoard />
      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><h2>Last 6 months</h2><div className="legend"><span><i style={{ background: 'var(--good)' }} />In</span><span><i style={{ background: 'var(--ink)' }} />Out</span></div></div>
          <Chart txns={txns} month={month} />
        </div>
        <div className="panel">
          <div className="panel-h"><h2>Spending by category</h2><p>{monthLabel(month)} · orange tick = budget</p></div>
          <CatBars txns={txns} month={month} limits={limits} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Recent entries</h2><Link to="/transactions">See all</Link></div>
        {recent.length ? <TxnTable rows={recent} onPick={canEdit(user) ? setEditing : undefined} compact /> : <div className="empty">No entries yet.</div>}
      </section>
      {editing && <TxnModal txn={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Chart({ txns, month }: { txns: Txn[]; month: string }) {
  const months = [...Array(6)].map((_, i) => shiftMonth(month, i - 5));
  const data = months.map((ym) => ({ ym, ...totals(inMonth(txns, ym)) }));
  const top = Math.max(0, ...data.map((d) => Math.max(d.inc, d.exp)));
  let max = 10000;
  if (top > 0) { const p = 10 ** Math.floor(Math.log10(top)); max = [1, 2, 2.5, 5, 10].map((x) => x * p).find((v) => v >= top)!; }
  const W = 560, H = 230, L = 48, R = 8, T = 10, B = 28, cw = (W - L - R) / 6, bw = Math.min(22, cw / 3.2);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Money in and out for the last six months">
      {[0, 1, 2, 3, 4].map((i) => { const v = (max * i) / 4; return (
        <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{fmtK(v)}</text></g>
      ); })}
      {data.map((d, i) => { const cx = L + cw * i + cw / 2, sel = d.ym === month; return (
        <g key={d.ym} opacity={sel ? 1 : 0.75}>
          <rect x={cx - bw - 2} y={y(d.inc)} width={bw} height={Math.max(0, y(0) - y(d.inc))} rx={2} fill="var(--good)"><title>{`${monthLabel(d.ym)} in: ${fmt(d.inc)}`}</title></rect>
          <rect x={cx + 2} y={y(d.exp)} width={bw} height={Math.max(0, y(0) - y(d.exp))} rx={2} fill="var(--ink)"><title>{`${monthLabel(d.ym)} out: ${fmt(d.exp)}`}</title></rect>
          <text x={cx} y={H - 8} textAnchor="middle" style={sel ? { fill: 'var(--ink)', fontWeight: 600 } : undefined}>{monthLabel(d.ym, true)}</text>
        </g>
      ); })}
    </svg>
  );
}

function CatBars({ txns, month, limits }: { txns: Txn[]; month: string; limits: Record<string, number> }) {
  const spent = spendByCat(txns, month);
  const cats = [...new Set([...Object.keys(spent), ...Object.keys(limits)])].sort((a, b) => (spent[b] || 0) - (spent[a] || 0));
  if (!cats.length) return <div className="empty">No spending logged for {monthLabel(month)}.</div>;
  const scale = Math.max(...cats.map((c) => Math.max(spent[c] || 0, limits[c] || 0)));
  return (
    <>
      {cats.map((c) => {
        const s = spent[c] || 0, l = limits[c] || 0, cls = l && s > l ? 'crit' : l && s >= 0.8 * l ? 'warn' : '';
        return (
          <div className="cat" key={c}>
            <span>{c}</span>
            <div className="track"><div className={`fill ${cls}`} style={{ width: `${(s / scale) * 100}%` }} />{l > 0 && <div className="mark" style={{ left: `calc(${(l / scale) * 100}% - 1px)` }} title={`Budget ${fmt(l)}`} />}</div>
            <span className="n">{fmt(s)}{l ? ` / ${fmtK(l)}` : ''}</span>
          </div>
        );
      })}
    </>
  );
}

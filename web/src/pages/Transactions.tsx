import { useMemo, useState } from 'react';
import { useMonth } from '../App';
import { canEdit, useAuth, useBooks } from '../lib/store';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LINES, fmt, monthLabel, monthOf } from '../lib/format';
import { totals } from '../lib/derive';
import TxnTable from '../components/TxnTable';
import TxnModal from '../components/TxnModal';
import type { Txn } from '../lib/types';

export default function Transactions() {
  const [month] = useMonth();
  const { user } = useAuth();
  const { txns } = useBooks();
  const [range, setRange] = useState<'month' | 'all'>('month');
  const [type, setType] = useState<'all' | 'EXPENSE' | 'INCOME'>('all');
  const [cat, setCat] = useState('all');
  const [line, setLine] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Txn | null>(null);

  const cats = type === 'INCOME' ? INCOME_CATEGORIES : type === 'EXPENSE' ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES.filter((c) => !EXPENSE_CATEGORIES.includes(c))];
  const rows = useMemo(() => {
    const ql = query.trim().toLowerCase();
    return txns.filter((t) => (range === 'all' || monthOf(t.date) === month) && (type === 'all' || t.type === type) && (cat === 'all' || t.category === cat)
      && (line === 'all' || t.line === line) && (!ql || [t.party, t.description, t.category].join(' ').toLowerCase().includes(ql)));
  }, [txns, range, month, type, cat, line, query]);
  const tot = totals(rows);
  const [y, m] = month.split('-');
  const last = new Date(Number(y), Number(m), 0).getDate();
  const exportUrl = range === 'month' ? `/api/txns/export.csv?from=${month}-01&to=${month}-${last}` : '/api/txns/export.csv';

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Transactions</h2>
        <a className="btn small" href={exportUrl} download>Download CSV ({range === 'month' ? monthLabel(month) : 'all time'})</a>
      </div>
      <div className="filters">
        <select aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value as 'month')}><option value="month">{monthLabel(month)}</option><option value="all">All time</option></select>
        <select aria-label="Type" value={type} onChange={(e) => { setType(e.target.value as 'all'); setCat('all'); }}><option value="all">All types</option><option value="EXPENSE">Money out</option><option value="INCOME">Money in</option></select>
        <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Line" value={line} onChange={(e) => setLine(e.target.value)}><option value="all">All lines</option>{LINES.map((l) => <option key={l}>{l}</option>)}</select>
        <input type="search" aria-label="Search" placeholder="Search vendor, customer or note" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {rows.length ? (
        <>
          <TxnTable rows={rows} onPick={canEdit(user) ? setEditing : undefined} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="sub">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · in {fmt(tot.inc)} · out {fmt(tot.exp)}</span>
            <b className={`num ${tot.net >= 0 ? 'pos' : 'neg'}`}>Net {fmt(tot.net)}</b>
          </div>
        </>
      ) : <div className="empty">No entries match these filters.</div>}
      {editing && <TxnModal txn={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

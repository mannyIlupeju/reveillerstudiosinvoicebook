import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useBooks, useToast } from '../lib/store';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LINES, dayLabel, fmt, iso } from '../lib/format';

type Row = Record<string, string>;
type Mapping = { date: string; desc: string; party: string; amount: string; debit: string; credit: string; mode: 'signed' | 'split' };

// Guess which column is which from common bank export headers (Wealthsimple, RBC, TD, etc.).
function guess(headers: string[]): Mapping {
  const find = (...res: RegExp[]) => headers.find((h) => res.some((r) => r.test(h))) || '';
  const debit = find(/debit|withdraw|money out|paid out/i);
  const credit = find(/credit|deposit|money in|paid in/i);
  return {
    date: find(/^date$/i, /transaction date|posted|date/i),
    desc: find(/description|details|memo|transaction/i),
    party: find(/payee|merchant|name|vendor/i),
    amount: find(/^amount$/i, /amount|value|cad/i),
    debit, credit,
    mode: debit && credit && !find(/^amount$/i) ? 'split' : 'signed',
  };
}

function parseDate(s: string): string | null {
  const t = (s || '').trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // assume MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : iso(d);
}
const money = (s: string) => {
  const t = (s || '').trim();
  if (!t) return NaN;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = parseFloat(t.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) * (neg ? -1 : 1) : NaN;
};

// Keyword rules for a first-pass category. Everything can be changed after import.
const RULES: [RegExp, string, 'EXPENSE' | 'INCOME'][] = [
  [/shopify.*(payout|deposit)|shopify payments/i, 'Online Sales', 'INCOME'],
  [/shopify|adobe|google|notion|figma|canva|squarespace|apple\.com|dropbox|github|openai|anthropic|claude/i, 'Software & Subscriptions', 'EXPENSE'],
  [/meta|facebook|instagram|tiktok|ads/i, 'Marketing & Ads', 'EXPENSE'],
  [/canada post|ups|fedex|dhl|purolator|chit chats|stallion|uline/i, 'Packaging & Shipping', 'EXPENSE'],
  [/gildan|bella|as colour|blank|fabric|textile|thread/i, 'Blanks & Materials', 'EXPENSE'],
  [/print|embroider|screen|manufact|factory/i, 'Production & Manufacturing', 'EXPENSE'],
  [/rent|studio/i, 'Studio & Rent', 'EXPENSE'],
  [/uber|lyft|presto|via rail|air canada|westjet|porter|esso|petro|shell/i, 'Travel & Transport', 'EXPENSE'],
  [/fee|interest|service charge/i, 'Bank & Payment Fees', 'EXPENSE'],
];
const categorize = (text: string, type: 'EXPENSE' | 'INCOME') => {
  for (const [re, cat, t] of RULES) if (t === type && re.test(text)) return cat;
  return type === 'INCOME' ? 'Other Income' : 'Miscellaneous';
};

export default function ImportCsv() {
  const { reload } = useBooks();
  const toast = useToast();
  const nav = useNavigate();
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Mapping | null>(null);
  const [line, setLine] = useState('Shared');
  const [flip, setFlip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<Record<number, boolean>>({});

  const onFile = (f: File) => {
    setErr('');
    Papa.parse<Row>(f, {
      header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
      complete: (res) => {
        const hs = (res.meta.fields || []).filter(Boolean);
        if (!hs.length || !res.data.length) { setErr('That file has no rows we can read. Export it as CSV with a header row.'); return; }
        setFile(f.name); setRows(res.data.slice(0, 5000)); setHeaders(hs); setMap(guess(hs)); setOverrides({}); setSkip({});
      },
      error: (e) => setErr(`Couldn’t read that file: ${e.message}`),
    });
  };

  const preview = useMemo(() => {
    if (!map) return [];
    return rows.map((r, idx) => {
      const date = parseDate(r[map.date]);
      let cents = map.mode === 'split' ? (money(r[map.credit]) || 0) - Math.abs(money(r[map.debit]) || 0) : money(r[map.amount]);
      if (flip) cents = -cents;
      const desc = (r[map.desc] || '').trim();
      const party = (map.party ? r[map.party] : '')?.trim() || desc.split(/\s{2,}| - /)[0].slice(0, 60);
      const type: 'EXPENSE' | 'INCOME' = cents >= 0 ? 'INCOME' : 'EXPENSE';
      const ok = !!date && Number.isFinite(cents) && cents !== 0;
      return { idx, ok, date, amountCents: Math.abs(cents), type, party, description: desc === party ? '' : desc, category: overrides[idx] || categorize(`${party} ${desc}`, type) };
    });
  }, [rows, map, flip, overrides]);
  const good = preview.filter((p) => p.ok && !skip[p.idx]);

  const commit = async () => {
    setBusy(true);
    try {
      const r = await api<{ imported: number; skipped: number }>('/import', { body: { rows: good.map(({ date, amountCents, type, party, description, category }) => ({ date, amountCents, type, party, description, category, line })) } });
      await reload();
      toast(`Imported ${r.imported} entries${r.skipped ? `, skipped ${r.skipped} already in your books` : ''}`);
      nav('/transactions');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const sel = (key: keyof Mapping, label: string, optional = false) => (
    <label className="field">{label}
      <select value={map![key] as string} onChange={(e) => setMap({ ...map!, [key]: e.target.value })}>
        <option value="">{optional ? 'None' : 'Choose a column'}</option>
        {headers.map((h) => <option key={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <section className="panel">
        <div className="panel-h"><div><h2>Import a bank CSV</h2><p>Export transactions from Wealthsimple (or any bank) as CSV, then match the columns. Entries already in your books are skipped, so it’s safe to import overlapping date ranges.</p></div></div>
        <label className="btn filebtn" style={{ alignSelf: 'flex-start' }}>{file ? `Choose a different file (${file})` : 'Choose CSV file'}<input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} /></label>
        {err && <p className="err">{err}</p>}
        {map && (
          <div className="mb" style={{ padding: 0 }}>
            {sel('date', 'Date column')}
            {sel('desc', 'Description column')}
            {sel('party', 'Payee column', true)}
            <label className="field">Amounts are
              <select value={map.mode} onChange={(e) => setMap({ ...map, mode: e.target.value as Mapping['mode'] })}>
                <option value="signed">One column, negative = money out</option>
                <option value="split">Separate debit and credit columns</option>
              </select>
            </label>
            {map.mode === 'signed' ? sel('amount', 'Amount column') : <>{sel('debit', 'Debit (money out) column')}{sel('credit', 'Credit (money in) column')}</>}
            <label className="field">Tag imported entries as<select value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="field full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} style={{ minHeight: 0 }} />Flip signs (use if purchases are showing as money in)</label>
          </div>
        )}
      </section>
      {map && (
        <section className="panel">
          <div className="panel-h">
            <div><h2>Preview</h2><p>{good.length} of {preview.length} rows will be imported. Adjust categories here or later.</p></div>
            <button className="btn primary" onClick={commit} disabled={busy || !good.length}>{busy ? 'Importing…' : `Import ${good.length} entries`}</button>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Include</th><th>Date</th><th>Payee</th><th>Category</th><th className="amt">Amount</th></tr></thead>
            <tbody>
              {preview.slice(0, 300).map((p) => (
                <tr key={p.idx} style={{ opacity: p.ok && !skip[p.idx] ? 1 : 0.45 }}>
                  <td><input type="checkbox" aria-label="Include row" disabled={!p.ok} checked={p.ok && !skip[p.idx]} onChange={(e) => setSkip((s) => ({ ...s, [p.idx]: !e.target.checked }))} style={{ minHeight: 0 }} /></td>
                  <td>{p.date ? dayLabel(p.date) : <span className="neg">Bad date</span>}</td>
                  <td>{p.party}<span className="sub">{p.description}</span></td>
                  <td>
                    <select aria-label="Category" value={p.category} onChange={(e) => setOverrides((o) => ({ ...o, [p.idx]: e.target.value }))} disabled={!p.ok}>
                      {(p.type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className={`amt ${p.type === 'INCOME' ? 'pos' : ''}`}>{p.ok ? `${p.type === 'INCOME' ? '+' : '−'}${fmt(p.amountCents)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {preview.length > 300 && <p className="hint">Showing the first 300 rows. All {good.length} included rows will be imported.</p>}
        </section>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/browser';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useBooks, useToast } from '../lib/store';
import { CURRENCIES, EXPENSE_CATEGORIES, LINES, PRODUCTION_CATEGORIES, RUN_STATUSES, centsInput, fmtCur, toCents, today } from '../lib/format';
import { cellText, parseDate } from '../lib/parse';

type Cell = unknown;
type Field = 'supplier' | 'contact' | 'product' | 'quantity' | 'paid' | 'balance' | 'notes' | 'platform' | 'currency';
const FIELDS: { key: Field; label: string; required?: boolean; guess: RegExp[] }[] = [
  { key: 'supplier', label: 'Supplier', required: true, guess: [/^supplier$/i, /supplier|vendor|manufacturer|factory|company/i] },
  { key: 'contact', label: 'Contact person', guess: [/contact|rep|person/i] },
  { key: 'product', label: 'Product', guess: [/^product$/i, /product|item|style/i] },
  { key: 'quantity', label: 'Quantity', guess: [/quantity|qty|units|pieces|moq/i] },
  { key: 'paid', label: 'Paid so far', guess: [/paid|deposit|payment/i] },
  { key: 'balance', label: 'Balance owed', guess: [/balance|remaining|owed|outstanding|due$/i] },
  { key: 'notes', label: 'Notes', guess: [/notes?|missing|comment/i] },
  { key: 'platform', label: 'Platform', guess: [/platform|source|marketplace/i] },
  { key: 'currency', label: 'Currency', guess: [/^currency$/i] },
];
const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

// Pull the first amount out of text like "424.75 USD initial payment (paid Oct 20)". "0 — paid in full" and "Nothing paid" give 0.
function amountIn(text: string): number {
  if (!text || /^(n\/?a|none|nothing|no |-)/i.test(text.trim())) return 0;
  const m = text.replace(/,(?=\d{3}\b)/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : 0;
}
function currencyIn(text: string): string | null {
  if (/USD|US\$/i.test(text)) return 'USD';
  if (/CAD|C\$/i.test(text)) return 'CAD';
  if (/EUR|€/i.test(text)) return 'EUR';
  if (/GBP|£/i.test(text)) return 'GBP';
  if (/RMB|CNY|¥|yuan/i.test(text)) return 'CNY';
  return null;
}
// "paid Oct 20" / "Oct 30, 2026" / "2026-10-20"; a date without a year takes the sheet's year.
function dateIn(text: string, year: number): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
  if (!m) return null;
  let y = m[3] ? Number(m[3]) : year;
  let d = `${y}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (!m[3] && d > today()) { y -= 1; d = `${y}${d.slice(4)}`; }
  return d;
}
const firstInt = (text: string) => { const m = text.match(/\d[\d,]*/); return m ? Number(m[0].replace(/,/g, '')) : 0; };
function categoryFor(product: string) {
  const p = product.toLowerCase();
  if (/sample/.test(p)) return 'Samples & Development';
  if (/sticker|label|tag|box|packag|bag|mailer/.test(p)) return 'Packaging & Shipping';
  if (/fabric|blank|thread|trim|button|zip|patch/.test(p)) return 'Blanks & Materials';
  return 'Production & Manufacturing';
}

type Row = {
  include: boolean; supplier: string; contact: string; platform: string; notes: string; product: string;
  quantity: string; currency: string; category: string; paid: string; paidDate: string; balance: string; createRun: boolean;
};

export default function ImportSuppliers() {
  const { reload } = useBooks();
  const toast = useToast();
  const nav = useNavigate();
  const [file, setFile] = useState('');
  const [sheets, setSheets] = useState<{ name: string; rows: Cell[][] }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [map, setMap] = useState<Record<Field, number>>({} as Record<Field, number>);
  const [defCurrency, setDefCurrency] = useState('USD');
  const [defPlatform, setDefPlatform] = useState('Alibaba');
  const [line, setLine] = useState('Shared');
  const [runStatus, setRunStatus] = useState('In production');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const sheet = sheets[sheetIdx];
  const headerIdx = sheet ? Math.max(0, sheet.rows.findIndex((r) => r.filter((c) => cellText(c)).length >= 2)) : 0;
  const headers = sheet ? (sheet.rows[headerIdx] || []).map((c, i) => cellText(c) || `Column ${i + 1}`) : [];

  const autoMap = (hs: string[]) => {
    const m = {} as Record<Field, number>;
    const used = new Set<number>();
    for (const f of FIELDS) {
      m[f.key] = -1;
      for (const re of f.guess) {
        const i = hs.findIndex((h, k) => !used.has(k) && re.test(h));
        if (i >= 0) { m[f.key] = i; used.add(i); break; }
      }
    }
    return m;
  };
  const choose = (s: typeof sheets, idx: number) => {
    setSheets(s); setSheetIdx(idx);
    const sh = s[idx];
    const hi = Math.max(0, sh.rows.findIndex((r) => r.filter((c) => cellText(c)).length >= 2));
    setMap(autoMap((sh.rows[hi] || []).map((c, i) => cellText(c) || `Column ${i + 1}`)));
  };
  const onFile = async (f: File) => {
    setErr('');
    try {
      let s;
      if (/\.csv$/i.test(f.name) || f.type === 'text/csv') s = [{ name: f.name, rows: Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data as Cell[][] }];
      else if (/\.xlsx$/i.test(f.name)) s = (await readXlsxFile(f)).map((b) => ({ name: b.sheet, rows: b.data as Cell[][] })).filter((b) => b.rows.length);
      else { setErr('Choose an Excel (.xlsx) or CSV file. From Google Sheets: File → Download → Microsoft Excel (.xlsx).'); return; }
      if (!s.length) { setErr('That file looks empty.'); return; }
      setFile(f.name); choose(s, 0);
    } catch (e: any) { setErr(`Couldn’t read that file. ${e?.message || ''}`); }
  };

  // Rebuild the editable rows whenever the file, sheet or column mapping changes.
  useEffect(() => {
    if (!sheet) return;
    const all = sheet.rows.flat().map(cellText).join(' ');
    const years = [...all.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
    const year = years.length ? years.sort((a, b) => years.filter((y) => y === b).length - years.filter((y) => y === a).length)[0] : new Date().getFullYear();
    const get = (r: Cell[], f: Field) => (map[f] >= 0 ? cellText(r[map[f]]) : '');
    setRows(sheet.rows.slice(headerIdx + 1).filter((r) => get(r, 'supplier')).map((r) => {
      const paidText = get(r, 'paid'), balText = get(r, 'balance'), product = get(r, 'product');
      const currency = currencyIn(get(r, 'currency')) || currencyIn(paidText) || currencyIn(balText) || currencyIn(product) || defCurrency;
      const paid = amountIn(paidText);
      const quantity = firstInt(get(r, 'quantity'));
      const paidDate = dateIn(paidText, year) || (paid ? parseDate(paidText) : null) || '';
      return {
        include: true, supplier: get(r, 'supplier'), contact: get(r, 'contact'), platform: get(r, 'platform') || defPlatform, notes: get(r, 'notes'),
        product, quantity: quantity ? String(quantity) : '', currency, category: categoryFor(product),
        paid: paid ? centsInput(paid) : '', paidDate, balance: amountIn(balText) ? centsInput(amountIn(balText)) : '',
        createRun: paid > 0 && quantity >= 10 && categoryFor(product) === 'Production & Manufacturing',
      };
    }));
  }, [sheet, headerIdx, map, defCurrency, defPlatform]);

  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const problems = (r: Row) => [
    toCents(r.paid) > 0 && !r.paidDate && 'payment date',
    r.createRun && !(Number(r.quantity) > 0) && 'quantity',
    r.createRun && !r.product && 'product',
  ].filter(Boolean) as string[];
  const blocked = chosen.some((r) => problems(r).length);

  const commit = async () => {
    setBusy(true); setErr('');
    try {
      const body = {
        line, runStatus,
        rows: chosen.map((r) => ({
          supplier: r.supplier, contact: r.contact, platform: r.platform, notes: r.notes, product: r.product,
          quantity: Number(r.quantity) > 0 ? Math.round(Number(r.quantity)) : null, currency: r.currency, category: r.category,
          payment: toCents(r.paid) > 0 ? { amountCents: toCents(r.paid), date: r.paidDate } : null,
          balance: toCents(r.balance) > 0 ? { amountCents: toCents(r.balance) } : null,
          createRun: r.createRun,
        })),
      };
      const res = await api<{ suppliers: number; runs: number; payments: number; bills: number; skipped: string[] }>('/suppliers/import', { body });
      await reload();
      toast(`Added ${res.suppliers} supplier${res.suppliers === 1 ? '' : 's'}, ${res.payments} payment${res.payments === 1 ? '' : 's'}, ${res.bills} bill${res.bills === 1 ? '' : 's'} and ${res.runs} run${res.runs === 1 ? '' : 's'}${res.skipped.length ? ` (${res.skipped.length} already recorded)` : ''}`);
      nav('/suppliers');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>Import suppliers</h2>
            <p>Upload a supplier or order tracking sheet (.xlsx or .csv). Each row adds the supplier, plus what you’ve paid (as an expense), any balance still owed (as a bill) and, if you choose, a production run. Amounts in another currency are converted to CAD at the Bank of Canada rate for the payment date.</p>
          </div>
          <Link className="btn small" to="/suppliers">Back to suppliers</Link>
        </div>
        <label className="btn filebtn" style={{ alignSelf: 'flex-start' }}>{file ? `Choose a different file (${file})` : 'Choose spreadsheet'}
          <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </label>
        <p className="hint">Google Sheets: File → Download → Microsoft Excel (.xlsx), then choose that file here.</p>
        {err && <p className="err">{err}</p>}
        {sheet && (
          <div className="mb" style={{ padding: 0 }}>
            {sheets.length > 1 && <label className="field full">Sheet<select value={sheetIdx} onChange={(e) => choose(sheets, Number(e.target.value))}>{sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></label>}
            {FIELDS.map((f) => (
              <label key={f.key} className="field">{f.label}{f.required ? '' : ' (optional)'}
                <select value={map[f.key] ?? -1} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>{f.required ? 'Choose a column' : 'None'}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
            <label className="field">Currency when not stated<select value={defCurrency} onChange={(e) => setDefCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="field">Platform when not stated<input value={defPlatform} onChange={(e) => setDefPlatform(e.target.value)} /></label>
            <label className="field">Tag as line<select value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="field">Status for new runs<select value={runStatus} onChange={(e) => setRunStatus(e.target.value)}>{RUN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
        )}
      </section>

      {sheet && (
        <section className="panel">
          <div className="panel-h">
            <div><h2>Check and adjust</h2><p>Amounts and dates were read from the text in your sheet. Fix anything that’s off before importing.</p></div>
            <button className="btn primary" onClick={commit} disabled={busy || !chosen.length || blocked}>{busy ? 'Importing…' : `Import ${chosen.length} row${chosen.length === 1 ? '' : 's'}`}</button>
          </div>
          {rows.length ? (
            <div className="tablewrap"><table className="edit">
              <thead><tr><th /><th>Supplier / product</th><th>Currency</th><th className="amt">Paid</th><th>Paid on</th><th className="amt">Still owed</th><th>Category</th><th>Run</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = r.include ? problems(r) : [];
                  return (
                    <tr key={i} style={{ opacity: r.include ? 1 : 0.45 }}>
                      <td><input type="checkbox" aria-label="Include row" checked={r.include} onChange={(e) => upd(i, { include: e.target.checked })} style={{ minHeight: 0 }} /></td>
                      <td style={{ minWidth: 220 }}><b>{r.supplier}</b>{r.contact && <span className="sub">{r.contact}</span>}
                        <input aria-label="Product" value={r.product} onChange={(e) => upd(i, { product: e.target.value })} style={{ marginTop: 4, width: '100%' }} />
                        {p.length > 0 && <span className="sub neg">Missing {p.join(', ')}</span>}</td>
                      <td><select aria-label="Currency" value={r.currency} onChange={(e) => upd(i, { currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                      <td className="amt"><input aria-label="Paid" inputMode="decimal" value={r.paid} onChange={(e) => upd(i, { paid: e.target.value })} style={{ width: 96, textAlign: 'right' }} placeholder="0" />
                        {toCents(r.paid) > 0 && <span className="sub">{fmtCur(toCents(r.paid), r.currency)}</span>}</td>
                      <td><input aria-label="Paid on" type="date" value={r.paidDate} onChange={(e) => upd(i, { paidDate: e.target.value })} disabled={!(toCents(r.paid) > 0)} /></td>
                      <td className="amt"><input aria-label="Still owed" inputMode="decimal" value={r.balance} onChange={(e) => upd(i, { balance: e.target.value })} style={{ width: 96, textAlign: 'right' }} placeholder="0" /></td>
                      <td><select aria-label="Category" value={r.category} onChange={(e) => upd(i, { category: e.target.value })}>
                        {[...PRODUCTION_CATEGORIES, ...EXPENSE_CATEGORIES.filter((c) => !PRODUCTION_CATEGORIES.includes(c))].map((c) => <option key={c}>{c}</option>)}</select></td>
                      <td style={{ whiteSpace: 'nowrap' }}><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={r.createRun} onChange={(e) => upd(i, { createRun: e.target.checked })} style={{ minHeight: 0 }} />Create</label>
                        {r.createRun && <input aria-label="Quantity" inputMode="numeric" value={r.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} placeholder="Units" style={{ width: 70, marginTop: 4 }} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          ) : <div className="empty">{map.supplier < 0 ? 'Choose which column holds the supplier name.' : 'No rows with a supplier name found.'}</div>}
        </section>
      )}
    </>
  );
}

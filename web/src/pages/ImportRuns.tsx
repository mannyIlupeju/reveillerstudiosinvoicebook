import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/browser';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useBooks, useToast } from '../lib/store';
import { EXPENSE_CATEGORIES, LINES, RUN_STATUSES, dayLabelY, fmt, today } from '../lib/format';
import { cellText, parseDate, parseMoney } from '../lib/parse';

type Cell = unknown;
type Field = 'name' | 'date' | 'line' | 'status' | 'units' | 'retail' | 'wholesale' | 'costDate' | 'vendor' | 'item' | 'amount' | 'category' | 'notes';
const FIELDS: { key: Field; label: string; required?: boolean; guess: RegExp[] }[] = [
  { key: 'name', label: 'Run name', required: true, guess: [/^run( name)?$/i, /run|drop|collection|batch|style|product/i] },
  { key: 'units', label: 'Units produced', required: true, guess: [/units|qty|quantity|pieces|pcs/i] },
  { key: 'date', label: 'Run date', guess: [/^(run )?date$/i, /start|produced|production date|date/i] },
  { key: 'amount', label: 'Cost amount', guess: [/^(cost )?amount$/i, /cost|amount|total|spent|price paid/i] },
  { key: 'vendor', label: 'Vendor / supplier', guess: [/vendor|supplier|manufacturer|factory|printer/i] },
  { key: 'item', label: 'Cost item / note', guess: [/item|description|what|detail|cost item/i] },
  { key: 'costDate', label: 'Cost date', guess: [/cost date|paid on|invoice date/i] },
  { key: 'category', label: 'Cost category', guess: [/category|type of cost/i] },
  { key: 'retail', label: 'Retail price', guess: [/retail|selling price|rrp|msrp/i] },
  { key: 'wholesale', label: 'Wholesale price', guess: [/wholesale/i] },
  { key: 'line', label: 'Line', guess: [/^line$|brand|label/i] },
  { key: 'status', label: 'Status', guess: [/status|stage/i] },
  { key: 'notes', label: 'Run notes', guess: [/notes?$|comment/i] },
];

const TEMPLATE = [
  ['Run name', 'Run date', 'Line', 'Units', 'Retail price', 'Wholesale price', 'Status', 'Vendor', 'Cost item', 'Cost amount', 'Cost category', 'Cost date', 'Notes'],
  ['RVS Drop 01 hoodies', '2025-03-01', 'RVS', '50', '120', '60', 'Sold out', 'Fleece supplier', 'Blank hoodies', '1100', 'Blanks & Materials', '2025-02-20', 'First drop'],
  ['RVS Drop 01 hoodies', '', '', '', '', '', '', 'Toronto Embroidery', 'Front + back embroidery', '900', 'Production & Manufacturing', '2025-02-27', ''],
  ['Reveillerstudios trousers', '2026-09-15', 'Reveillerstudios', '30', '180', '', 'In production', 'Pattern maker', 'Pattern + samples', '650', 'Samples & Development', '2026-08-30', ''],
];

function guessCategory(text: string) {
  const t = text.toLowerCase();
  const exact = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === t);
  if (exact) return exact;
  if (/blank|fabric|material|thread|trim|zip|button/.test(t)) return 'Blanks & Materials';
  if (/sample|pattern|proto|develop/.test(t)) return 'Samples & Development';
  if (/pack|ship|freight|courier|postage|label|tag|bag/.test(t)) return 'Packaging & Shipping';
  if (/photo|shoot|content|model/.test(t)) return 'Photography & Content';
  return 'Production & Manufacturing';
}
const guessStatus = (v: string, fallback: string) => RUN_STATUSES.find((s) => s.toLowerCase() === v.toLowerCase()) || (/sold/i.test(v) ? 'Sold out' : /sell|live|launch/i.test(v) ? 'Selling' : /prod|making/i.test(v) ? 'In production' : /plan/i.test(v) ? 'Planning' : fallback);
const guessLine = (v: string, fallback: string) => (/^rvs/i.test(v) ? 'RVS' : /reveiller/i.test(v) ? 'Reveillerstudios' : /shared|both/i.test(v) ? 'Shared' : fallback);

type Sheet = { name: string; rows: Cell[][] };
type RunDraft = {
  name: string; date: string | null; line: string; status: string; units: number; retailPriceCents: number | null; wholesalePriceCents: number | null; notes: string;
  costs: { date: string | null; amountCents: number; party: string; description: string; category: string }[];
  problems: string[];
};

export default function ImportRuns() {
  const { runs, reload } = useBooks();
  const toast = useToast();
  const nav = useNavigate();
  const [file, setFile] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [map, setMap] = useState<Record<Field, number>>({} as Record<Field, number>);
  const [defLine, setDefLine] = useState('RVS');
  const [defStatus, setDefStatus] = useState('Sold out');
  const [costMode, setCostMode] = useState<'history' | 'books'>('history');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const sheet = sheets[sheetIdx];
  const headerIdx = sheet ? Math.max(0, sheet.rows.findIndex((r) => r.filter((c) => cellText(c)).length >= 2)) : 0;
  const headers = sheet ? (sheet.rows[headerIdx] || []).map((c, i) => cellText(c) || `Column ${i + 1}`) : [];

  const autoMap = (hs: string[]) => {
    const m = {} as Record<Field, number>;
    const used = new Set<number>();
    for (const f of FIELDS) {
      for (const re of f.guess) {
        const i = hs.findIndex((h, k) => !used.has(k) && re.test(h));
        if (i >= 0) { m[f.key] = i; used.add(i); break; }
      }
      if (m[f.key] === undefined) m[f.key] = -1;
    }
    return m;
  };

  const choose = (s: Sheet[], idx: number) => {
    setSheets(s);
    setSheetIdx(idx);
    const sh = s[idx];
    const hi = Math.max(0, sh.rows.findIndex((r) => r.filter((c) => cellText(c)).length >= 2));
    setMap(autoMap((sh.rows[hi] || []).map((c, i) => cellText(c) || `Column ${i + 1}`)));
  };

  const onFile = async (f: File) => {
    setErr('');
    try {
      let s: Sheet[];
      if (/\.csv$/i.test(f.name) || f.type === 'text/csv') {
        const text = await f.text();
        const res = Papa.parse<string[]>(text, { skipEmptyLines: true });
        s = [{ name: f.name, rows: res.data }];
      } else if (/\.xlsx$/i.test(f.name)) {
        const book = await readXlsxFile(f);
        s = book.map((b) => ({ name: b.sheet, rows: b.data as Cell[][] })).filter((b) => b.rows.length);
      } else {
        setErr('Choose an Excel (.xlsx) or CSV file. In Google Sheets or Numbers, use File → Download or Export as .xlsx or .csv.');
        return;
      }
      if (!s.length) { setErr('That file looks empty.'); return; }
      setFile(f.name);
      choose(s, 0);
    } catch (e: any) {
      setErr(`Couldn’t read that file. ${/xls$/i.test(f.name) ? 'Older .xls files aren’t supported; save it as .xlsx first.' : e?.message || ''}`);
    }
  };

  const drafts = useMemo<RunDraft[]>(() => {
    if (!sheet) return [];
    const get = (row: Cell[], f: Field) => (map[f] >= 0 ? row[map[f]] : undefined);
    const byName = new Map<string, RunDraft>();
    let current: RunDraft | null = null;
    for (const row of sheet.rows.slice(headerIdx + 1)) {
      if (!row.some((c) => cellText(c))) continue;
      const name = cellText(get(row, 'name'));
      // A blank run name continues the run above, so cost lines can sit under one header row.
      const key = name ? name.toLowerCase() : current ? current.name.toLowerCase() : '';
      if (!key) continue;
      let d = byName.get(key);
      if (!d) {
        d = { name, date: null, line: defLine, status: defStatus, units: 0, retailPriceCents: null, wholesalePriceCents: null, notes: '', costs: [], problems: [] };
        byName.set(key, d);
      }
      current = d;
      const units = Math.round(Number(String(get(row, 'units') ?? '').replace(/[^0-9.]/g, '')));
      if (units > 0 && !d.units) d.units = units;
      const date = parseDate(get(row, 'date'));
      if (date && (!d.date || date < d.date)) d.date = date;
      const lineV = cellText(get(row, 'line')); if (lineV) d.line = guessLine(lineV, defLine);
      const statusV = cellText(get(row, 'status')); if (statusV) d.status = guessStatus(statusV, defStatus);
      const retail = parseMoney(get(row, 'retail')); if (retail > 0 && d.retailPriceCents == null) d.retailPriceCents = retail;
      const whole = parseMoney(get(row, 'wholesale')); if (whole > 0 && d.wholesalePriceCents == null) d.wholesalePriceCents = whole;
      const notes = cellText(get(row, 'notes')); if (notes && !d.notes.includes(notes)) d.notes = [d.notes, notes].filter(Boolean).join(' · ');
      const amount = Math.abs(parseMoney(get(row, 'amount')));
      if (amount > 0) {
        const party = cellText(get(row, 'vendor'));
        const description = cellText(get(row, 'item'));
        const catText = cellText(get(row, 'category'));
        d.costs.push({ date: parseDate(get(row, 'costDate')) || date || null, amountCents: amount, party, description, category: guessCategory(catText || `${description} ${party}`) });
      }
    }
    const existing = new Set(runs.map((r) => r.name.toLowerCase()));
    return [...byName.values()].map((d) => {
      const problems: string[] = [];
      if (!(d.units > 0)) problems.push('No units');
      if (existing.has(d.name.toLowerCase())) problems.push('Already in the app');
      const firstCost = d.costs.map((c) => c.date).filter(Boolean).sort()[0] || null;
      return { ...d, date: d.date || firstCost, problems };
    });
  }, [sheet, headerIdx, map, defLine, defStatus, runs]);

  const ready = drafts.filter((d) => !d.problems.length);
  const totalCost = ready.reduce((a, d) => a + d.costs.reduce((b, c) => b + c.amountCents, 0), 0);

  const commit = async () => {
    setBusy(true);
    setErr('');
    try {
      const body = { costMode, runs: ready.map((d) => ({ name: d.name, line: d.line, status: d.status, units: d.units, date: d.date || today(), retailPriceCents: d.retailPriceCents, wholesalePriceCents: d.wholesalePriceCents, notes: d.notes, costs: d.costs })) };
      const r = await api<{ created: number; skipped: string[] }>('/runs/import', { body });
      await reload();
      toast(`Imported ${r.created} run${r.created === 1 ? '' : 's'}${r.skipped.length ? `, skipped ${r.skipped.length} already in the app` : ''}`);
      nav('/production');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const csv = TEMPLATE.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'production-runs-template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>Import production runs</h2>
            <p>Upload an Excel (.xlsx) or CSV file of past or current runs. Put one row per run, or one row per cost line. Rows with the same run name, or a blank run name under it, are combined into one run.</p>
          </div>
          <div className="row"><button className="btn small" onClick={downloadTemplate}>Download template</button><Link className="btn small" to="/production">Back to runs</Link></div>
        </div>
        <label className="btn filebtn" style={{ alignSelf: 'flex-start' }}>{file ? `Choose a different file (${file})` : 'Choose spreadsheet'}
          <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </label>
        {err && <p className="err">{err}</p>}
        {sheet && (
          <div className="mb" style={{ padding: 0 }}>
            {sheets.length > 1 && (
              <label className="field full">Sheet<select value={sheetIdx} onChange={(e) => choose(sheets, Number(e.target.value))}>{sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></label>
            )}
            {FIELDS.map((f) => (
              <label key={f.key} className="field">{f.label}{f.required ? '' : ' (optional)'}
                <select value={map[f.key] ?? -1} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>{f.required ? 'Choose a column' : 'None'}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
            <label className="field">Line when not given<select value={defLine} onChange={(e) => setDefLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="field">Status when not given<select value={defStatus} onChange={(e) => setDefStatus(e.target.value)}>{RUN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <fieldset className="full field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ marginBottom: 6 }}>What should happen to the costs?</legend>
              <label style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, color: 'var(--ink)', fontWeight: 400, fontSize: 14 }}><input type="radio" name="cm" checked={costMode === 'history'} onChange={() => setCostMode('history')} style={{ minHeight: 0, marginTop: 3 }} />
                <span><b>Record on the runs only.</b> Unit costs and margins use them, but they don’t appear in Transactions or your monthly totals. Best for old runs, or if these costs are already in your books from a bank import.</span></label>
              <label style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, color: 'var(--ink)', fontWeight: 400, fontSize: 14, marginTop: 8 }}><input type="radio" name="cm" checked={costMode === 'books'} onChange={() => setCostMode('books')} style={{ minHeight: 0, marginTop: 3 }} />
                <span><b>Also add them to the books</b> as expenses tagged to each run, dated on the cost date. Use this for spending that isn’t recorded anywhere in the app yet.</span></label>
            </fieldset>
          </div>
        )}
      </section>

      {sheet && (
        <section className="panel">
          <div className="panel-h">
            <div><h2>Preview</h2><p>{ready.length} of {drafts.length} runs ready · {fmt(totalCost)} in costs{costMode === 'books' ? ' will be added to your books' : ' recorded on the runs'}.</p></div>
            <button className="btn primary" onClick={commit} disabled={busy || !ready.length}>{busy ? 'Importing…' : `Import ${ready.length} run${ready.length === 1 ? '' : 's'}`}</button>
          </div>
          {map.name < 0 ? <div className="empty">Choose which column holds the run name.</div> : drafts.length ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Run</th><th>Date</th><th className="amt">Units</th><th className="amt">Costs</th><th className="amt">Unit cost</th><th className="amt">Retail</th><th>Status</th></tr></thead>
              <tbody>
                {drafts.map((d) => {
                  const cost = d.costs.reduce((a, c) => a + c.amountCents, 0);
                  return (
                    <tr key={d.name} style={{ opacity: d.problems.length ? 0.5 : 1 }}>
                      <td>{d.name}<span className="sub">{d.line}{d.costs.length ? ` · ${d.costs.length} cost line${d.costs.length === 1 ? '' : 's'}` : ''}{d.notes ? ` · ${d.notes}` : ''}</span></td>
                      <td>{d.date ? dayLabelY(d.date) : <span className="sub">Today</span>}</td>
                      <td className="amt">{d.units || '—'}</td>
                      <td className="amt">{fmt(cost)}</td>
                      <td className="amt">{d.units && cost ? fmt(Math.round(cost / d.units)) : '—'}</td>
                      <td className="amt">{d.retailPriceCents ? fmt(d.retailPriceCents) : '—'}</td>
                      <td>{d.problems.length ? <span className="pill crit">{d.problems.join(', ')}</span> : <span className="pill">{d.status}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          ) : <div className="empty">No rows with a run name found.</div>}
        </section>
      )}
    </>
  );
}

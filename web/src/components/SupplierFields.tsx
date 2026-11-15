import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useBooks } from '../lib/store';
import { CURRENCIES, fmt, toCents, centsInput } from '../lib/format';
import type { Supplier } from '../lib/types';

/** Optional supplier picker with "+ New supplier…" that creates one on the spot. */
export function SupplierSelect({ value, onChange, id = 'f-supplier' }: { value: string; onChange: (id: string, name?: string) => void; id?: string }) {
  const { suppliers, reload } = useBooks();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    setErr('');
    try {
      const r = await api<{ supplier: Supplier }>('/suppliers', { body: { name: name.trim() } });
      await reload();
      onChange(r.supplier.id, r.supplier.name);
      setAdding(false);
      setName('');
    } catch (e: any) { setErr(e.message); }
  };
  if (adding) {
    return (
      <label>Supplier (new)
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <input id={`${id}-new`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" autoFocus style={{ flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } if (e.key === 'Escape') { e.preventDefault(); setAdding(false); } }} />
          <button type="button" className="btn small" onClick={create}>Add</button>
          <button type="button" className="btn small" onClick={() => setAdding(false)}>Cancel</button>
        </span>
        {err && <span className="err">{err}</span>}
      </label>
    );
  }
  const active = suppliers.filter((s) => !s.archived || s.id === value);
  return (
    <label>Supplier (optional)
      <select id={id} value={value} onChange={(e) => (e.target.value === '__new' ? setAdding(true) : onChange(e.target.value, suppliers.find((s) => s.id === e.target.value)?.name))}>
        <option value="">None</option>
        {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value="__new">+ New supplier…</option>
      </select>
    </label>
  );
}

export type Money = { currency: string; original: string; cad: string; rate: number | null; rateDate: string | null };
export const moneyFrom = (cadCents?: number | null, origCents?: number | null, currency?: string | null, rate?: string | number | null): Money => ({
  currency: currency || 'CAD',
  original: currency ? centsInput(origCents) : '',
  cad: centsInput(cadCents),
  rate: rate != null ? Number(rate) : null,
  rateDate: null,
});
/** Turns the form state into API fields, or throws a readable error. */
export function moneyToBody(m: Money) {
  const amountCents = toCents(m.cad);
  if (!(amountCents > 0)) throw new Error(m.currency === 'CAD' ? 'Enter an amount above zero.' : 'Enter the CAD amount, or wait for the exchange rate to load.');
  if (m.currency === 'CAD') return { amountCents, originalAmountCents: null, originalCurrency: null, fxRate: null };
  const originalAmountCents = toCents(m.original);
  if (!(originalAmountCents > 0)) throw new Error(`Enter the amount in ${m.currency}.`);
  return { amountCents, originalAmountCents, originalCurrency: m.currency, fxRate: m.rate ?? Math.round((amountCents / originalAmountCents) * 1e6) / 1e6 };
}

/**
 * Amount with a currency. For a foreign currency, the CAD amount fills in from the
 * Bank of Canada rate for the date, and can be overwritten with what the bank actually charged.
 */
export function MoneyInput({ value, onChange, date, label = 'Amount', idPrefix = 'm' }: { value: Money; onChange: (m: Money) => void; date: string; label?: string; idPrefix?: string }) {
  const [status, setStatus] = useState('');
  const edited = useRef(false); // CAD typed by hand: stop overwriting it
  const foreign = value.currency !== 'CAD';

  useEffect(() => {
    if (!foreign || edited.current) return;
    const cents = toCents(value.original);
    if (!(cents > 0) || !date) return;
    let live = true;
    setStatus('Getting the exchange rate…');
    const t = setTimeout(async () => {
      try {
        const r = await api<{ rate: number; date: string; cadCents: number }>(`/fx?currency=${value.currency}&date=${date}&amountCents=${cents}`);
        if (!live) return;
        onChange({ ...value, cad: centsInput(r.cadCents), rate: r.rate, rateDate: r.date });
        setStatus(`Bank of Canada rate ${r.rate.toFixed(4)} on ${r.date}. Change the CAD amount if your bank charged something different.`);
      } catch (e: any) { if (live) setStatus(e.message); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [value.currency, value.original, date]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <label>{label}
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <select id={`${idPrefix}-cur`} aria-label="Currency" value={value.currency} style={{ width: 84 }}
            onChange={(e) => { edited.current = false; setStatus(''); onChange({ ...value, currency: e.target.value, original: e.target.value === 'CAD' ? '' : value.original || value.cad, rate: null }); }}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input id={`${idPrefix}-amt`} inputMode="decimal" placeholder="0.00" style={{ flex: 1, minWidth: 0 }}
            value={foreign ? value.original : value.cad}
            onChange={(e) => (foreign ? (edited.current = false, onChange({ ...value, original: e.target.value })) : onChange({ ...value, cad: e.target.value }))} />
        </span>
      </label>
      {foreign && (
        <label>In CAD
          <input id={`${idPrefix}-cad`} inputMode="decimal" value={value.cad} placeholder="Converted amount"
            onChange={(e) => { edited.current = true; const cad = toCents(e.target.value), orig = toCents(value.original); onChange({ ...value, cad: e.target.value, rate: cad > 0 && orig > 0 ? Math.round((cad / orig) * 1e6) / 1e6 : value.rate }); }} />
        </label>
      )}
      {foreign && status && <p className="hint full">{status}</p>}
      {foreign && !status && toCents(value.cad) > 0 && <p className="hint full">{fmt(toCents(value.cad))} CAD{value.rate ? ` at ${value.rate.toFixed(4)}` : ''}.</p>}
    </>
  );
}

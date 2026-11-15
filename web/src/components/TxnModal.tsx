import { useState } from 'react';
import Modal from './Modal';
import { api } from '../lib/api';
import { useBooks, useToast } from '../lib/store';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LINES, centsInput, toCents, today } from '../lib/format';
import type { Txn } from '../lib/types';

// Shrink phone photos before upload so receipts stay small in the database.
async function compress(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadReceipt(txnId: string, file: File) {
  const blob = await compress(file);
  const fd = new FormData();
  const name = blob === file ? file.name : file.name.replace(/\.\w+$/, '') + '.jpg';
  fd.append('file', blob, name);
  return api(`/txns/${txnId}/receipts`, { form: fd });
}

type Props = { txn?: Txn | null; preset?: Partial<Txn>; onClose: () => void };

export default function TxnModal({ txn, preset = {}, onClose }: Props) {
  const { runs, reload } = useBooks();
  const toast = useToast();
  const base = { type: 'EXPENSE', date: today(), line: 'Shared', category: 'Miscellaneous', ...preset, ...(txn || {}) } as Txn;
  const [type, setType] = useState<Txn['type']>(base.type);
  const [amount, setAmount] = useState(centsInput(base.amountCents));
  const [date, setDate] = useState(base.date);
  const [party, setParty] = useState(base.party || '');
  const cats = type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const [category, setCategory] = useState(cats.includes(base.category) ? base.category : cats[0]);
  const [description, setDescription] = useState(base.description || '');
  const [line, setLine] = useState(base.line || 'Shared');
  const [runId, setRunId] = useState(base.runId || '');
  const [files, setFiles] = useState<File[]>([]);
  const [receipts, setReceipts] = useState(txn?.receipts || []);

  const switchType = (t: Txn['type']) => {
    setType(t);
    const list = t === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if (!list.includes(category)) setCategory(list[0]);
    if (t === 'INCOME') setRunId('');
  };

  const save = async () => {
    const amountCents = toCents(amount);
    if (!(amountCents > 0)) throw new Error('Enter an amount above zero.');
    if (!date) throw new Error('Pick a date.');
    const body = { type, amountCents, date, party, category, description, line, runId: type === 'EXPENSE' && runId ? runId : null };
    const res = txn ? await api<{ txn: Txn }>(`/txns/${txn.id}`, { method: 'PATCH', body }) : await api<{ txn: Txn }>('/txns', { body });
    for (const f of files) {
      try { await uploadReceipt(res.txn.id, f); } catch (e: any) { toast(`Saved, but ${f.name} didn’t upload: ${e.message}`); }
    }
    await reload();
    toast(txn ? 'Entry updated' : 'Entry added');
  };

  const remove = async () => {
    await api(`/txns/${txn!.id}`, { method: 'DELETE' });
    await reload();
    toast('Entry deleted');
  };

  const removeReceipt = async (id: string) => {
    await api(`/receipts/${id}`, { method: 'DELETE' });
    setReceipts((r) => r.filter((x) => x.id !== id));
    reload();
  };

  const autoSource = txn && txn.source !== 'APP' ? { RECURRING: 'a recurring charge', INVOICE: 'an invoice payment', SHOPIFY: 'a Shopify payment', IMPORT: 'a CSV import' }[txn.source as 'RECURRING'] : null;

  return (
    <Modal title={txn ? 'Edit entry' : 'Add entry'} onClose={onClose} onSubmit={save} onDelete={txn ? remove : undefined}>
      {autoSource && <p className="hint full">This entry came from {autoSource}.</p>}
      <div className="seg full" role="radiogroup" aria-label="Type">
        <label><input type="radio" name="type" checked={type === 'EXPENSE'} onChange={() => switchType('EXPENSE')} />Money out</label>
        <label><input type="radio" name="type" checked={type === 'INCOME'} onChange={() => switchType('INCOME')} />Money in</label>
      </div>
      <label>Amount (CAD)<input id="t-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus /></label>
      <label>Date<input id="t-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>{type === 'INCOME' ? 'Customer' : 'Vendor'}<input id="t-party" value={party} onChange={(e) => setParty(e.target.value)} placeholder={type === 'INCOME' ? 'e.g. Shopify payout' : 'e.g. Gildan, IB'} /></label>
      <label>Category<select id="t-category" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="full">Note<input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for?" /></label>
      <label>Line<select id="t-line" value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
      {type === 'EXPENSE' && (
        <label>Production run<select id="t-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
          <option value="">Not part of a run</option>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>
      )}
      <div className="full receipts">
        <span className="lbl">Receipts</span>
        {receipts.map((r) => (
          <div key={r.id} className="receipt">
            <a href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer">{r.filename}</a>
            <span className="sub">{Math.round(r.size / 1024)} KB</span>
            <button type="button" className="btn small danger" onClick={() => removeReceipt(r.id)}>Remove</button>
          </div>
        ))}
        {files.map((f, i) => (
          <div key={i} className="receipt"><span>{f.name}</span><span className="sub">uploads when you save</span>
            <button type="button" className="btn small" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>Remove</button></div>
        ))}
        {receipts.length + files.length < 5 && (
          <label className="btn small filebtn">
            + Attach photo or PDF
            <input id="t-file" type="file" accept="image/*,application/pdf"onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles((x) => [...x, f]); e.target.value = ''; }} />
          </label>
        )}
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { api } from '../lib/api';
import { useBooks, useToast } from '../lib/store';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LINES, PRODUCTION_CATEGORIES, today } from '../lib/format';
import { MoneyInput, SupplierSelect, moneyFrom, moneyToBody, type Money } from './SupplierFields';
import type { Receipt, Txn } from '../lib/types';

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

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';
const okType = (f: File) => ACCEPT.split(',').includes(f.type) || /\.(heic|heif)$/i.test(f.name);

// Photo previews with "Take photo" (opens the camera on phones), "Choose file", and drag-and-drop on desktop.
function ReceiptPicker({ saved, pending, onAdd, onRemovePending, onRemoveSaved }: {
  saved: Receipt[]; pending: File[]; onAdd: (f: File[]) => void; onRemovePending: (i: number) => void; onRemoveSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [over, setOver] = useState(false);
  const previews = useMemo(() => pending.map((f) => (f.type.startsWith('image/') && !/hei[cf]/i.test(f.type) ? URL.createObjectURL(f) : '')), [pending]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  const room = 5 - saved.length - pending.length;

  const take = (list: FileList | null) => {
    const fs = [...(list || [])];
    const good = fs.filter(okType);
    if (good.length < fs.length) toast('Receipts must be photos (JPG, PNG, WebP, HEIC) or PDFs.');
    if (good.length > room) toast(`You can attach up to 5 receipts per entry.`);
    if (good.length) onAdd(good.slice(0, room));
  };

  return (
    <div className={`full drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
      <span className="lbl hint">Receipt photos {room > 0 ? '· drag a file here, or' : '· 5 max'}</span>
      {(saved.length > 0 || pending.length > 0) && (
        <div className="thumbs">
          {saved.map((r) => (
            <a key={r.id} className="thumb" href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer" title={r.filename}>
              {r.mimeType.startsWith('image/') && !/hei[cf]/.test(r.mimeType) ? <img src={`/api/receipts/${r.id}`} alt={r.filename} loading="lazy" /> : <span>{r.mimeType === 'application/pdf' ? 'PDF' : 'Photo'}<br />{r.filename.slice(0, 18)}</span>}
              <button type="button" aria-label={`Remove ${r.filename}`} onClick={(e) => { e.preventDefault(); onRemoveSaved(r.id); }}>×</button>
            </a>
          ))}
          {pending.map((f, i) => (
            <div key={i} className="thumb" title={f.name}>
              {previews[i] ? <img src={previews[i]} alt={f.name} /> : <span>{f.type === 'application/pdf' ? 'PDF' : 'Photo'}<br />{f.name.slice(0, 18)}</span>}
              <span className="tag">New</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemovePending(i)}>×</button>
            </div>
          ))}
        </div>
      )}
      {room > 0 && (
        <div className="row">
          <label className="btn small filebtn">Take photo
            <input id="t-camera" type="file" accept="image/*" capture="environment" onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
          </label>
          <label className="btn small filebtn">Choose photo or PDF
            <input id="t-file" type="file" accept={`${ACCEPT},image/*`} multiple onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      )}
    </div>
  );
}

type Props = { txn?: Txn | null; preset?: Partial<Txn>; onClose: () => void };

export default function TxnModal({ txn, preset = {}, onClose }: Props) {
  const { runs, suppliers, reload } = useBooks();
  const toast = useToast();
  const base = { type: 'EXPENSE', date: today(), line: 'Shared', category: 'Miscellaneous', ...preset, ...(txn || {}) } as Txn;
  const [type, setType] = useState<Txn['type']>(base.type);
  const [money, setMoney] = useState<Money>(moneyFrom(base.amountCents, base.originalAmountCents, base.originalCurrency, base.fxRate));
  const [supplierId, setSupplierId] = useState(base.supplierId || '');
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
    if (t === 'INCOME') { setRunId(''); setSupplierId(''); }
  };
  // Supplier is optional; it's offered for production-type costs, or whenever one is already set.
  const showSupplier = type === 'EXPENSE' && (PRODUCTION_CATEGORIES.includes(category) || !!supplierId || !!runId);
  const pickSupplier = (id: string, name?: string) => { setSupplierId(id); if (id && name && !party.trim()) setParty(name); };
  const pickRun = (id: string) => {
    setRunId(id);
    const run = runs.find((r) => r.id === id);
    if (run?.supplierId && !supplierId) pickSupplier(run.supplierId, suppliers.find((x) => x.id === run.supplierId)?.name);
  };

  const save = async () => {
    if (!date) throw new Error('Pick a date.');
    const body = { type, ...moneyToBody(money), date, party, category, description, line,
      runId: type === 'EXPENSE' && runId ? runId : null, supplierId: type === 'EXPENSE' && supplierId ? supplierId : null };
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
      <MoneyInput value={money} onChange={setMoney} date={date} idPrefix="t" />
      <label>Date<input id="t-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>{type === 'INCOME' ? 'Customer' : 'Vendor'}<input id="t-party" value={party} onChange={(e) => setParty(e.target.value)} placeholder={type === 'INCOME' ? 'e.g. Shopify payout' : 'e.g. Gildan, IB'} /></label>
      <label>Category<select id="t-category" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      {showSupplier && <SupplierSelect value={supplierId} onChange={pickSupplier} id="t-supplier" />}
      <label className="full">Note<input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for?" /></label>
      <label>Line<select id="t-line" value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
      {type === 'EXPENSE' && (
        <label>Production run<select id="t-run" value={runId} onChange={(e) => pickRun(e.target.value)}>
          <option value="">Not part of a run</option>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>
      )}
      <ReceiptPicker
        saved={receipts}
        pending={files}
        onAdd={(fs) => setFiles((x) => [...x, ...fs].slice(0, 5 - receipts.length))}
        onRemovePending={(i) => setFiles((x) => x.filter((_, j) => j !== i))}
        onRemoveSaved={removeReceipt}
      />
    </Modal>
  );
}

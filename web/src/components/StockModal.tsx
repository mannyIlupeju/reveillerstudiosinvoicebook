import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { SupplierSelect } from './SupplierFields';
import { api } from '../lib/api';
import { useToast } from '../lib/store';
import { centsInput, fmt, toCents, today } from '../lib/format';
import { PHOTO_ACCEPT, browserCanShow, shrinkPhoto } from '../lib/photos';
import type { StockItem } from '../lib/types';

export const STOCK_CATEGORIES = ['Finished goods', 'Samples', 'Materials & trims', 'Packaging', 'Other'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'];
const MAX_PHOTOS = 8;

type Props = { item?: StockItem | null; colours: string[]; onClose: () => void; onSaved: () => void };

export default function StockModal({ item, colours, onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState(item?.name || '');
  const [category, setCategory] = useState(item?.category || 'Finished goods');
  const [size, setSize] = useState(item?.size || '');
  const [colour, setColour] = useState(item?.colour || '');
  const [qty, setQty] = useState(String(item?.quantity ?? 1));
  const [price, setPrice] = useState(centsInput(item?.priceCents ?? null));
  const [currency, setCurrency] = useState<'CAD' | 'USD'>(item?.currency || 'CAD');
  const [priceKind, setPriceKind] = useState<'COST' | 'RETAIL'>(item?.priceKind || 'COST');
  const [supplierId, setSupplierId] = useState(item?.supplierId || '');
  const [sku, setSku] = useState(item?.sku || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [saved, setSaved] = useState<string[]>(item?.photoIds || []);
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [cadPreview, setCadPreview] = useState<{ cents: number; rate: number } | null>(null);

  const previews = useMemo(() => pending.map((f) => (browserCanShow(f.type) ? URL.createObjectURL(f) : '')), [pending]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  const room = MAX_PHOTOS - saved.length - pending.length;

  // Live CAD estimate for USD prices, at today's Bank of Canada rate.
  useEffect(() => {
    setCadPreview(null);
    const cents = price.trim() ? toCents(price) : NaN;
    if (currency !== 'USD' || !Number.isFinite(cents) || cents <= 0) return;
    const t = setTimeout(() => {
      api<{ cadCents: number; rate: number }>(`/fx?currency=USD&date=${today()}&amountCents=${cents}`)
        .then((r) => setCadPreview({ cents: r.cadCents, rate: r.rate })).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [price, currency]);

  const take = async (list: FileList | null) => {
    const fs = [...(list || [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!fs.length) { if (list?.length) toast('Photos must be JPG, PNG, WebP or HEIC.'); return; }
    if (fs.length > room) toast(`Up to ${MAX_PHOTOS} photos per item.`);
    const shrunk = await Promise.all(fs.slice(0, room).map((f) => shrinkPhoto(f)));
    setPending((p) => [...p, ...shrunk]);
  };

  const save = async () => {
    if (!name.trim()) throw new Error('Give the item a name.');
    const quantity = qty.trim() === '' ? 0 : Number(qty);
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error('Quantity should be a whole number, 0 or more.');
    const priceCents = price.trim() ? toCents(price) : null;
    if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) throw new Error('Check the price.');
    const body = { name: name.trim(), category, size: size.trim(), colour: colour.trim(), quantity, priceCents, currency, priceKind, supplierId: supplierId || null, sku: sku.trim(), notes };
    const res = item
      ? await api<{ item: StockItem }>(`/stock/${item.id}`, { method: 'PATCH', body })
      : await api<{ item: StockItem }>('/stock', { body });
    const id = res.item.id;
    for (const pid of removed) await api(`/stock-photos/${pid}`, { method: 'DELETE' }).catch(() => {});
    let failed = 0;
    for (const f of pending) {
      const form = new FormData();
      form.append('file', f, f.name);
      await api(`/stock/${id}/photos`, { method: 'POST', form }).catch(() => { failed += 1; });
    }
    onSaved();
    toast(failed ? `Saved, but ${failed} photo${failed === 1 ? '' : 's'} didn’t upload. Open the item to try again.` : item ? 'Item updated' : `${name.trim()} added to inventory`);
  };

  const remove = async () => {
    if (!item) return;
    await api(`/stock/${item.id}`, { method: 'DELETE' });
    onSaved();
    toast('Item removed');
  };

  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add to inventory'} onClose={onClose} onSubmit={save} onDelete={item ? remove : undefined} deleteLabel="Remove item" submitLabel={item ? 'Save' : 'Add item'} wide>
      <label className="full">Item name<input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Washed denim cap, Denim patch, Mailer box" autoFocus maxLength={160} required /></label>

      <div className={`full drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
        <span className="lbl hint">Photos {room > 0 ? '· take one with your camera, attach from your device, or drag them here' : `· ${MAX_PHOTOS} max`}</span>
        {(saved.length > 0 || pending.length > 0) && (
          <div className="thumbs">
            {saved.map((pid, i) => (
              <a key={pid} className="thumb" href={`/api/stock-photos/${pid}`} target="_blank" rel="noreferrer">
                <img src={`/api/stock-photos/${pid}`} alt={`${name || 'Item'} photo ${i + 1}`} loading="lazy" />
                {i === 0 && <span className="tag">Cover</span>}
                <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={(e) => { e.preventDefault(); setSaved((s) => s.filter((x) => x !== pid)); setRemoved((r) => [...r, pid]); }}>×</button>
              </a>
            ))}
            {pending.map((f, i) => (
              <div key={i} className="thumb" title={f.name}>
                {previews[i] ? <img src={previews[i]} alt={f.name} /> : <span>Photo<br />{f.name.slice(0, 18)}</span>}
                <span className="tag">{saved.length === 0 && i === 0 ? 'Cover · new' : 'New'}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setPending((p) => p.filter((_, k) => k !== i))}>×</button>
              </div>
            ))}
          </div>
        )}
        {room > 0 && (
          <div className="row">
            <label className="btn small filebtn">Take photo
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="btn small filebtn">Attach photos
              <input type="file" accept={`${PHOTO_ACCEPT},image/*`} multiple onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
        )}
      </div>

      <label>Size<input id="s-size" list="s-sizes" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. M, 32x30, One size" maxLength={40} /></label>
      <datalist id="s-sizes">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
      <label>Colour<input id="s-colour" list="s-colours" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="e.g. Washed black" maxLength={60} /></label>
      <datalist id="s-colours">{colours.map((c) => <option key={c} value={c} />)}</datalist>

      <div className="full price-row">
        <label className="grow">Price per unit<input id="s-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></label>
        <div className="field">
          <span>Currency</span>
          <div className="toggle" role="radiogroup" aria-label="Currency">
            {(['CAD', 'USD'] as const).map((c) => <button type="button" key={c} role="radio" aria-checked={currency === c} className={currency === c ? 'on' : ''} onClick={() => setCurrency(c)}>{c}</button>)}
          </div>
        </div>
        <div className="field">
          <span>This price is</span>
          <div className="toggle" role="radiogroup" aria-label="Price type">
            {([['COST', 'What we paid'], ['RETAIL', 'Selling price']] as const).map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={priceKind === k} className={priceKind === k ? 'on' : ''} onClick={() => setPriceKind(k)}>{l}</button>)}
          </div>
        </div>
      </div>
      {currency === 'USD' && (
        <p className="hint full">
          {cadPreview ? `≈ ${fmt(cadPreview.cents)} CAD at today’s Bank of Canada rate (${cadPreview.rate.toFixed(4)}). Saved in USD with the CAD amount alongside.` : 'The CAD amount is worked out at today’s Bank of Canada rate when you save.'}
        </p>
      )}

      <label>Quantity on hand<input id="s-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} /></label>
      <label>Type<select id="s-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
        {STOCK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select></label>
      <SupplierSelect id="s-supplier" value={supplierId} onChange={(id) => setSupplierId(id)} />
      <label>SKU (optional)<input id="s-sku" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={60} /></label>
      <label className="full">Notes<textarea id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where it’s stored, condition, what it’s for…" maxLength={2000} /></label>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal';
import StockModal, { STOCK_CATEGORIES } from '../components/StockModal';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { centsInput, fmt, fmtCur, sum, toCents } from '../lib/format';
import { runStats } from '../lib/derive';
import type { InventoryItem, Run, StockItem, SyncStatus, Txn } from '../lib/types';

const DEFAULT_LOW = 2;
type Stock = 'out' | 'low' | 'ok' | 'untracked';
const stockOf = (i: InventoryItem): Stock => (!i.tracked ? 'untracked' : i.quantity <= 0 ? 'out' : i.quantity <= (i.lowStockAt ?? DEFAULT_LOW) ? 'low' : 'ok');
const STOCK_PILL: Record<Stock, [string, string]> = { out: ['crit', 'Out'], low: ['warn', 'Low'], ok: ['good', 'In stock'], untracked: ['', 'Not tracked'] };

// Unit cost: a cost set in the app wins, then the linked production run's unit cost, then Shopify's cost.
function unitCost(i: InventoryItem, runs: Run[], txns: Txn[]): { cents: number | null; source: string } {
  if (i.unitCostCents != null) return { cents: i.unitCostCents, source: 'Set here' };
  const run = i.runId ? runs.find((r) => r.id === i.runId) : null;
  if (run) {
    const s = runStats(run, txns);
    if (s.total > 0) return { cents: Math.round(s.unit), source: `Run: ${run.name}` };
  }
  if (i.shopifyUnitCostCents != null) return { cents: i.shopifyUnitCostCents, source: 'Shopify' };
  return { cents: null, source: '' };
}

function ShopifyInventory() {
  const { user } = useAuth();
  const { runs, txns, shopify } = useBooks();
  const toast = useToast();
  const editor = canEdit(user);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'nocost'>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: InventoryItem[]; sync: SyncStatus }>('/inventory');
      setItems(r.items);
      setSync(r.sync);
      setErr('');
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runSync = async () => {
    setBusy(true);
    try { const r = await api<{ sync: SyncStatus }>('/inventory/sync', { body: {} }); await load(); toast(`Synced ${r.sync.count} variants from Shopify`); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const rows = useMemo(() => (items || []).map((i) => ({ ...i, cost: unitCost(i, runs, txns), stock: stockOf(i) })), [items, runs, txns]);
  const visible = rows.filter((i) => (showInactive || i.productStatus === 'ACTIVE')
    && (filter === 'all' || (filter === 'attention' ? i.stock === 'out' || i.stock === 'low' : i.cost.cents == null))
    && (!query.trim() || [i.productTitle, i.variantTitle, i.sku, i.productType].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
  const groups = useMemo(() => {
    const m = new Map<string, typeof visible>();
    for (const r of visible) m.set(r.shopifyProductId, [...(m.get(r.shopifyProductId) || []), r]);
    return [...m.values()];
  }, [visible]);

  const active = rows.filter((i) => i.productStatus === 'ACTIVE' && i.tracked);
  const units = sum(active, (i) => Math.max(0, i.quantity));
  const withCost = active.filter((i) => i.cost.cents != null);
  const costValue = sum(withCost, (i) => Math.max(0, i.quantity) * (i.cost.cents || 0));
  const retailValue = sum(active, (i) => Math.max(0, i.quantity) * i.priceCents);
  const attention = active.filter((i) => i.stock === 'out' || i.stock === 'low');
  const missingCost = active.filter((i) => i.cost.cents == null && i.quantity > 0).length;

  if (!shopify.configured) return <div className="welcome"><h2>Shopify isn’t connected</h2><p>Shopify products and stock levels show up here once the Shopify keys are on the server. Items you add yourself are under Studio items.</p></div>;

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>Shopify products</h2>
            <p>Stock levels come from Shopify and refresh every 15 minutes. Set unit costs here, or link a product to a production run, to see what your stock is worth.</p>
          </div>
          <div className="row">
            {sync?.at && <span className="sub">{sync.ok ? 'Synced' : 'Last attempt'} {new Date(sync.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}</span>}
            {editor && <button className="btn" onClick={runSync} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>}
          </div>
        </div>
        {(err || (sync && sync.ok === false)) && <div className="banner crit">{err || sync?.error}</div>}
      </section>

      {items && items.length === 0 ? (
        <div className="welcome"><h2>No products yet</h2><p>Click Sync now to pull your products and stock levels from Shopify.</p></div>
      ) : items && (
        <>
          <section className="tiles">
            <div className="tile"><span className="k">Units in stock</span><span className="v">{units.toLocaleString('en-CA')}</span><span className="s">Across {active.length} active variants</span></div>
            <div className="tile"><span className="k">Stock value at cost</span><span className="v">{fmt(costValue)}</span><span className="s">{missingCost ? `${missingCost} in-stock variant${missingCost === 1 ? '' : 's'} missing a cost` : 'All costs set'}</span></div>
            <div className="tile"><span className="k">Retail value</span><span className="v">{fmt(retailValue)}</span><span className="s">At current Shopify prices</span></div>
            <div className="tile"><span className="k">Needs restock</span><span className={`v ${attention.length ? 'neg' : ''}`}>{attention.length}</span><span className="s">{active.filter((i) => i.stock === 'out').length} out · {active.filter((i) => i.stock === 'low').length} low</span></div>
          </section>

          <section className="panel">
            <div className="filters">
              <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as 'all')}>
                <option value="all">All variants</option>
                <option value="attention">Low or out of stock</option>
                <option value="nocost">Missing unit cost</option>
              </select>
              <input type="search" aria-label="Search products" placeholder="Search product, size or SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
              <label className="row sub" style={{ gap: 6 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} style={{ minHeight: 0 }} />Show draft and archived</label>
            </div>
            {groups.length ? (
              <div className="tablewrap"><table>
                <thead><tr><th>Product</th><th className="amt">Stock</th><th className="amt hide-sm">Price</th><th className="amt">Unit cost</th><th className="amt hide-sm">Margin</th><th className="amt hide-sm">Value at cost</th></tr></thead>
                <tbody>
                  {groups.map((g) => {
                    const p = g[0];
                    return [
                      <tr key={p.shopifyProductId} className="group">
                        <td colSpan={6}>
                          <div className="prod">
                            {p.imageUrl ? <img src={`${p.imageUrl}${p.imageUrl.includes('?') ? '&' : '?'}width=80`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="noimg" />}
                            <div><b>{p.productTitle}</b><span className="sub">{[p.productType, p.productStatus !== 'ACTIVE' && p.productStatus.toLowerCase(), `${sum(g, (i) => Math.max(0, i.quantity))} in stock`].filter(Boolean).join(' · ')}</span></div>
                          </div>
                        </td>
                      </tr>,
                      ...g.map((i) => {
                        const margin = i.cost.cents != null && i.priceCents ? (i.priceCents - i.cost.cents) / i.priceCents : null;
                        return (
                          <tr key={i.shopifyVariantId} className={editor ? 'click' : ''} onClick={editor ? () => setEditing(i) : undefined} tabIndex={editor ? 0 : undefined} onKeyDown={editor ? (e) => e.key === 'Enter' && setEditing(i) : undefined}>
                            <td style={{ paddingLeft: 58 }}>{i.variantTitle || 'Default'}{i.sku && <span className="sub">SKU {i.sku}</span>}</td>
                            <td className="amt"><span className="num">{i.tracked ? i.quantity : '—'}</span> <span className={`pill ${STOCK_PILL[i.stock][0]}`}>{STOCK_PILL[i.stock][1]}</span></td>
                            <td className="amt hide-sm">{fmt(i.priceCents)}</td>
                            <td className="amt">{i.cost.cents != null ? fmt(i.cost.cents) : <span className="sub">Not set</span>}{i.cost.source && <span className="sub">{i.cost.source}</span>}</td>
                            <td className={`amt hide-sm ${margin !== null && margin < 0.5 ? 'neg' : ''}`}>{margin === null ? '—' : `${Math.round(margin * 100)}%`}</td>
                            <td className="amt hide-sm">{i.cost.cents != null && i.tracked ? fmt(Math.max(0, i.quantity) * i.cost.cents) : '—'}</td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table></div>
            ) : <div className="empty">No variants match.</div>}
          </section>
        </>
      )}
      {!items && !err && <div className="center muted">Loading inventory…</div>}
      {editing && <ItemModal item={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  );
}

function ItemModal({ item, onClose, onSaved }: { item: InventoryItem; onClose: () => void; onSaved: () => void }) {
  const { runs, txns } = useBooks();
  const toast = useToast();
  const [cost, setCost] = useState(centsInput(item.unitCostCents));
  const [runId, setRunId] = useState(item.runId || '');
  const [low, setLow] = useState(item.lowStockAt != null ? String(item.lowStockAt) : '');
  const [all, setAll] = useState(true);
  const run = runs.find((r) => r.id === runId);
  const runUnit = run ? runStats(run, txns) : null;

  const save = async () => {
    const unitCostCents = cost.trim() ? toCents(cost) : null;
    if (Number.isNaN(unitCostCents)) throw new Error('Check the unit cost.');
    const lowStockAt = low.trim() ? Math.round(Number(low)) : null;
    if (lowStockAt != null && !(lowStockAt >= 0)) throw new Error('Check the low-stock number.');
    await api(`/inventory/${encodeURIComponent(item.shopifyVariantId)}`, { method: 'PATCH', body: { unitCostCents, runId: runId || null, lowStockAt, applyToProduct: all } });
    onSaved();
    toast(all ? `Saved for every variant of ${item.productTitle}` : 'Saved');
  };

  return (
    <Modal title={[item.productTitle, item.variantTitle].filter(Boolean).join(' – ')} onClose={onClose} onSubmit={save}>
      <p className="hint full">{item.tracked ? `${item.quantity} in stock` : 'Shopify isn’t tracking stock for this item'} · sells for {fmt(item.priceCents)}{item.shopifyUnitCostCents != null ? ` · Shopify cost ${fmt(item.shopifyUnitCostCents)}` : ''}</p>
      <label>Unit cost (CAD)<input id="inv-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={runUnit && runUnit.total > 0 ? `From run: ${fmt(Math.round(runUnit.unit))}` : 'What one unit cost you'} autoFocus /></label>
      <label>Production run<select id="inv-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
        <option value="">None</option>
        {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select></label>
      <label>Low-stock alert at<input id="inv-low" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} placeholder={`${DEFAULT_LOW} or fewer`} /></label>
      <label className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ minHeight: 0 }} />Apply to all variants of this product</label>
      <p className="hint full">Leave the unit cost empty to use the linked run’s cost per unit (its tagged expenses ÷ units). A cost typed here always wins.</p>
    </Modal>
  );
}

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'shopify' ? 'shopify' : 'studio';
  return (
    <>
      <div className="toggle tabs" role="tablist" aria-label="Inventory">
        <button role="tab" aria-selected={tab === 'studio'} className={tab === 'studio' ? 'on' : ''} onClick={() => setParams({})}>Studio items</button>
        <button role="tab" aria-selected={tab === 'shopify'} className={tab === 'shopify' ? 'on' : ''} onClick={() => setParams({ tab: 'shopify' })}>Shopify products</button>
      </div>
      {tab === 'studio' ? <StudioItems /> : <ShopifyInventory />}
    </>
  );
}

type Kind = 'all' | string;
function StudioItems() {
  const { user } = useAuth();
  const toast = useToast();
  const editor = canEdit(user);
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [editing, setEditing] = useState<StockItem | null | 'new'>(null);

  const load = useCallback(async () => {
    try { setItems((await api<{ items: StockItem[] }>('/stock')).items); setErr(''); }
    catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const bump = async (it: StockItem, d: number) => {
    const quantity = Math.max(0, it.quantity + d);
    setItems((xs) => xs && xs.map((x) => (x.id === it.id ? { ...x, quantity } : x)));
    try { await api(`/stock/${it.id}`, { method: 'PATCH', body: { quantity } }); }
    catch (e: any) { toast(e.message); load(); }
  };

  const all = items || [];
  const colours = [...new Set(all.map((i) => i.colour).filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const shown = all.filter((i) => (kind === 'all' || i.category === kind)
    && (!q || [i.name, i.size, i.colour, i.sku, i.supplierName, i.notes].join(' ').toLowerCase().includes(q)));
  const units = sum(all, (i) => i.quantity);
  const costItems = all.filter((i) => i.priceKind === 'COST' && i.priceCadCents != null);
  const retailItems = all.filter((i) => i.priceKind === 'RETAIL' && i.priceCadCents != null);

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>Studio items</h2>
            <p>Pieces, samples, materials and packaging you track yourself, outside Shopify. Prices can be in CAD or USD; USD is converted to CAD when saved.</p>
          </div>
          {editor && <button className="btn primary" onClick={() => setEditing('new')}>+ Add item</button>}
        </div>
        {err && <div className="banner crit">{err}</div>}
      </section>

      {items && all.length > 0 && (
        <section className="tiles">
          <div className="tile"><span className="k">Items</span><span className="v">{all.length}</span><span className="s">{units.toLocaleString('en-CA')} units on hand</span></div>
          <div className="tile"><span className="k">Value at cost</span><span className="v">{fmt(sum(costItems, (i) => i.quantity * (i.priceCadCents || 0)))}</span><span className="s">{costItems.length} item{costItems.length === 1 ? '' : 's'} with a cost</span></div>
          <div className="tile"><span className="k">Value at selling price</span><span className="v">{fmt(sum(retailItems, (i) => i.quantity * (i.priceCadCents || 0)))}</span><span className="s">{retailItems.length} item{retailItems.length === 1 ? '' : 's'} with a selling price</span></div>
          <div className="tile"><span className="k">Out of stock</span><span className={`v ${all.some((i) => i.quantity === 0) ? 'neg' : ''}`}>{all.filter((i) => i.quantity === 0).length}</span><span className="s">Items at zero</span></div>
        </section>
      )}

      {items && all.length === 0 && (
        <div className="welcome">
          <h2>Nothing added yet</h2>
          <p>Add finished pieces, samples, fabric, trims like patches and buttons, or packaging. Each item can have photos, a size, a colour and a price in CAD or USD.</p>
          {editor && <button className="btn primary" onClick={() => setEditing('new')}>+ Add your first item</button>}
        </div>
      )}

      {items && all.length > 0 && (
        <section className="panel">
          <div className="filters">
            <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All types</option>
              {STOCK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input type="search" aria-label="Search items" placeholder="Search name, size, colour, supplier" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {shown.length ? (
            <div className="stock-grid">
              {shown.map((i) => (
                <article key={i.id} className="stock-card">
                  <button className="stock-photo" onClick={() => editor && setEditing(i)} aria-label={editor ? `Edit ${i.name}` : i.name} disabled={!editor}>
                    {i.photoIds[0] ? <img src={`/api/stock-photos/${i.photoIds[0]}`} alt="" loading="lazy" /> : <span className="nophoto">No photo</span>}
                    {i.photoIds.length > 1 && <span className="count">{i.photoIds.length} photos</span>}
                  </button>
                  <div className="stock-body">
                    <div className="stock-title">
                      <h3>{editor ? <button className="linkish" onClick={() => setEditing(i)}>{i.name}</button> : i.name}</h3>
                      <span className="pill">{i.category}</span>
                    </div>
                    {(i.size || i.colour) && (
                      <div className="chips">
                        {i.size && <span className="chip"><span className="k">Size</span>{i.size}</span>}
                        {i.colour && <span className="chip"><span className="k">Colour</span>{i.colour}</span>}
                      </div>
                    )}
                    <div className="stock-price">
                      {i.priceCents != null ? (
                        <>
                          <b>{fmtCur(i.priceCents, i.currency)}</b>
                          {i.currency === 'USD' && i.priceCadCents != null && <span className="muted">≈ {fmt(i.priceCadCents)} CAD</span>}
                          <span className="muted">{i.priceKind === 'COST' ? 'cost each' : 'selling price'}</span>
                        </>
                      ) : <span className="muted">No price</span>}
                    </div>
                    {i.supplierName && <div className="muted small">From {i.supplierName}</div>}
                    <div className="stock-qty">
                      {editor ? (
                        <div className="stepper" aria-label={`Quantity of ${i.name}`}>
                          <button aria-label="One fewer" onClick={() => bump(i, -1)} disabled={i.quantity === 0}>−</button>
                          <span className="num">{i.quantity}</span>
                          <button aria-label="One more" onClick={() => bump(i, 1)}>+</button>
                        </div>
                      ) : <span className="num">{i.quantity}</span>}
                      <span className="muted">on hand</span>
                      {i.quantity === 0 && <span className="pill crit">Out</span>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty">No items match.</div>}
        </section>
      )}
      {!items && !err && <div className="center muted">Loading…</div>}
      {editing && <StockModal item={editing === 'new' ? null : editing} colours={colours} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { centsInput, fmt, sum, toCents } from '../lib/format';
import { runStats } from '../lib/derive';
import type { InventoryItem, Run, SyncStatus, Txn } from '../lib/types';

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

export default function Inventory() {
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

  if (!shopify.configured) return <div className="welcome"><h2>Connect Shopify to see inventory</h2><p>Stock levels come from your Shopify store. Once the Shopify keys are on the server, products show up here automatically.</p></div>;

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>Inventory</h2>
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

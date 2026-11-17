import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { STAGES, STAGE_LABEL, STAGE_PILL, ago, isLate, useOrderSummary } from '../lib/orders';
import { fmtCur } from '../lib/format';
import type { OrderStage, ShopOrder } from '../lib/types';

type Resp = { configured: boolean; orders: ShopOrder[]; customerHidden: boolean; at: string | null; team: { id: string; name: string; email: string }[] };
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function Orders() {
  const { user } = useAuth();
  const { shopify } = useBooks();
  const { refresh: refreshBadge } = useOrderSummary();
  const toast = useToast();
  const editor = canEdit(user);
  const [view, setView] = useState<'open' | 'recent'>('open');
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stageFilter, setStageFilter] = useState<'all' | OrderStage | 'mine'>('all');

  const load = useCallback(async (fresh = false) => {
    setBusy(true);
    try {
      setData(await api<Resp>(`/orders?view=${view}${fresh ? '&fresh=1' : ''}`));
      setError('');
      if (fresh) refreshBadge();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }, [view, refreshBadge]);
  useEffect(() => { setData(null); load(); }, [load]);

  const saveTask = async (o: ShopOrder, patch: Partial<ShopOrder['task']>) => {
    const before = data;
    setData((d) => d && { ...d, orders: d.orders.map((x) => (x.id === o.id ? { ...x, task: { ...x.task, ...patch } } : x)) });
    try {
      await api(`/orders/${o.id}/task`, { method: 'PUT', body: { orderName: o.name, ...patch } });
      if (patch.stage) { toast(`${o.name} marked ${STAGE_LABEL[patch.stage].toLowerCase()}`); refreshBadge(); }
    } catch (e: any) { setData(before); toast(e.message); }
  };

  if (!shopify.configured) {
    return <section className="panel"><div className="empty">Shopify isn’t connected, so there are no orders to show. Connect it in Settings.</div></section>;
  }

  const orders = data?.orders || [];
  const shown = view === 'recent' ? orders : orders.filter((o) => stageFilter === 'all' || (stageFilter === 'mine' ? o.task.assignedTo === user?.id : o.task.stage === stageFilter));
  const nameOf = (id: string | null) => data?.team.find((t) => t.id === id)?.name || '';

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>Shopify orders</h2>
            <p>New orders from the store, for packing and shipping. Fulfil and add tracking in Shopify; the order moves to “Recently fulfilled” once it ships.{data?.at ? ` Checked ${ago(data.at)}.` : ''}</p>
          </div>
          <button className="btn" onClick={() => load(true)} disabled={busy}>{busy ? 'Checking…' : 'Refresh'}</button>
        </div>
        <div className="filters">
          <div className="toggle" role="tablist" aria-label="Orders">
            <button role="tab" aria-selected={view === 'open'} className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>To fulfil{view === 'open' && data ? ` (${orders.length})` : ''}</button>
            <button role="tab" aria-selected={view === 'recent'} className={view === 'recent' ? 'on' : ''} onClick={() => setView('recent')}>Recently fulfilled</button>
          </div>
          {view === 'open' && orders.length > 0 && (
            <select aria-label="Packing stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as 'all')}>
              <option value="all">All stages</option>
              {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              <option value="mine">Assigned to me</option>
            </select>
          )}
        </div>
        {data?.customerHidden && (
          <div className="banner warn" style={{ marginTop: 12 }}>
            Customer names and shipping addresses are hidden because the Shopify app doesn’t have access to customer data yet. Open the order in Shopify to see the address.
          </div>
        )}
      </section>

      {error && <div className="banner crit">{error}</div>}
      {!data && !error && <div className="center muted">Loading orders…</div>}
      {data && !shown.length && (
        <section className="panel"><div className="empty">
          {view === 'recent' ? 'No fulfilled orders yet.' : orders.length ? 'No orders match this filter.' : 'All caught up. No orders waiting to be fulfilled.'}
        </div></section>
      )}

      <div className="orders">
        {shown.map((o) => {
          const late = view === 'open' && isLate(o.createdAt);
          const left = o.items.reduce((n, i) => n + i.unfulfilled, 0);
          return (
            <article key={o.id} className={`order${late ? ' late' : ''}`}>
              <header className="order-h">
                <div>
                  <h3>{o.name}</h3>
                  <div className="meta">
                    <span title={new Date(o.createdAt).toLocaleString('en-CA')}>{ago(o.createdAt)}</span>
                    <span>{fmtCur(o.totalCents, o.currency)}</span>
                    {o.shipping && <span>{o.shipping}</span>}
                  </div>
                </div>
                <div className="order-pills">
                  {late && <span className="pill crit">Over 3 days</span>}
                  <span className={`pill ${o.financialStatus === 'PAID' ? 'good' : 'warn'}`}>{words(o.financialStatus)}</span>
                  {view === 'open' && o.fulfillmentStatus === 'PARTIALLY_FULFILLED' && <span className="pill accent">Partly shipped</span>}
                  {view === 'open' && !editor && <span className={`pill ${STAGE_PILL[o.task.stage]}`}>{STAGE_LABEL[o.task.stage]}</span>}
                </div>
              </header>

              <ul className="order-items">
                {o.items.filter((i) => view === 'recent' || i.unfulfilled > 0).map((i) => (
                  <li key={i.id}>
                    {i.image ? <img src={i.image} alt="" loading="lazy" /> : <span className="thumb" aria-hidden="true" />}
                    <span className="it">
                      <b>{i.title}</b>
                      <span className="muted">{[i.variant, i.sku && `SKU ${i.sku}`].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="qty">× {view === 'recent' ? i.quantity : i.unfulfilled}</span>
                  </li>
                ))}
              </ul>
              {view === 'open' && <div className="muted small">{left} item{left === 1 ? '' : 's'} to ship</div>}

              <div className="order-foot">
                {o.customer && (o.customer.name || o.customer.address.length > 0) && (
                  <address className="ship-to">
                    <span className="k">Ship to</span>
                    {o.customer.name && <b>{o.customer.name}</b>}
                    {o.customer.address.map((l, k) => <span key={k}>{l}</span>)}
                    {o.customer.phone && <span className="muted">{o.customer.phone}</span>}
                  </address>
                )}
                {o.note && <div className="order-note"><span className="k">Customer note</span>{o.note}</div>}
                {view === 'recent' && o.tracking.length > 0 && (
                  <div className="order-note"><span className="k">Tracking</span>
                    {o.tracking.map((t, k) => <span key={k}>{t.company} {t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.number}</a> : t.number}</span>)}
                  </div>
                )}
              </div>

              {view === 'open' && (
                <div className="order-task">
                  {editor ? (
                    <>
                      <div className="toggle small" role="radiogroup" aria-label={`Packing stage for ${o.name}`}>
                        {STAGES.map(([k, l]) => (
                          <button key={k} role="radio" aria-checked={o.task.stage === k} className={o.task.stage === k ? `on ${STAGE_PILL[k]}` : ''} onClick={() => o.task.stage !== k && saveTask(o, { stage: k })}>{l}</button>
                        ))}
                      </div>
                      <select aria-label={`Who is packing ${o.name}`} value={o.task.assignedTo || ''} onChange={(e) => saveTask(o, { assignedTo: e.target.value || null })}>
                        <option value="">Unassigned</option>
                        {data!.team.map((t) => <option key={t.id} value={t.id}>{t.name || t.email}</option>)}
                      </select>
                      <NoteField value={o.task.note} onSave={(note) => saveTask(o, { note })} />
                    </>
                  ) : (
                    <span className="muted">{o.task.assignedTo ? `Packing: ${nameOf(o.task.assignedTo)}` : 'Unassigned'}{o.task.note ? ` · ${o.task.note}` : ''}</span>
                  )}
                </div>
              )}
              {o.adminUrl && (
                <a className={`btn ${view === 'open' && o.task.stage === 'PACKED' ? 'primary' : ''}`} href={o.adminUrl} target="_blank" rel="noreferrer">
                  {view === 'open' ? 'Fulfil in Shopify ↗' : 'Open in Shopify ↗'}
                </a>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function NoteField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="order-team-note" placeholder="Team note (e.g. gift wrap, out of size M)" value={v} maxLength={2000}
      onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

import { useEffect, useState } from 'react';
import Modal from '../components/Modal';
import { api } from '../lib/api';
import { canEdit, useAuth, useBooks, useToast } from '../lib/store';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LINES, addDays, centsInput, dayLabel, fmt, fmtCur, sum, toCents, today } from '../lib/format';
import { invStatus } from '../lib/derive';
import { MoneyInput, SupplierSelect, moneyFrom, moneyToBody, type Money } from '../components/SupplierFields';
import type { Invoice, Item } from '../lib/types';

const PILL = { open: 'accent', overdue: 'crit', paid: 'good', void: '' } as const;

export default function Invoices() {
  const { user } = useAuth();
  const { invoices, shopify, suppliers, reload } = useBooks();
  const toast = useToast();
  const editor = canEdit(user);
  const [editing, setEditing] = useState<Invoice | { kind: Invoice['kind'] } | null>(null);
  const [sharing, setSharing] = useState<Invoice | null>(null);
  const [checking, setChecking] = useState(false);
  const rec = invoices.filter((i) => i.kind === 'RECEIVABLE');
  const pay = invoices.filter((i) => i.kind === 'PAYABLE');
  const openR = rec.filter((i) => i.status === 'OPEN');
  const openP = pay.filter((i) => i.status === 'OPEN');

  const markPaid = async (i: Invoice) => {
    try { await api(`/invoices/${i.id}/pay`, { body: {} }); await reload(); toast(i.kind === 'RECEIVABLE' ? 'Marked paid and logged as money in' : 'Marked paid and logged as money out'); }
    catch (e: any) { toast(e.message); }
  };
  const syncAll = async () => {
    setChecking(true);
    try { const r = await api<{ paid: number }>('/invoices/sync', { body: {} }); await reload(); toast(r.paid ? `${r.paid} invoice${r.paid === 1 ? '' : 's'} paid through Shopify` : 'No new Shopify payments'); }
    catch (e: any) { toast(e.message); }
    finally { setChecking(false); }
  };

  const table = (list: Invoice[], kind: Invoice['kind']) => {
    if (!list.length) return <div className="empty">{kind === 'RECEIVABLE' ? 'No invoices yet.' : 'No bills yet.'}</div>;
    const order = { overdue: 0, open: 1, paid: 2, void: 3 };
    const sorted = [...list].sort((a, b) => order[invStatus(a)] - order[invStatus(b)] || a.dueDate.localeCompare(b.dueDate));
    return (
      <div className="tablewrap"><table>
        <thead><tr><th>{kind === 'RECEIVABLE' ? 'Client' : 'Vendor'}</th><th>Invoice</th><th>Due</th><th className="amt">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>
          {sorted.map((i) => {
            const st = invStatus(i);
            return (
              <tr key={i.id}>
                <td>{i.party}<span className="sub">{[i.category, i.supplierId && suppliers.find((x) => x.id === i.supplierId)?.name !== i.party && suppliers.find((x) => x.id === i.supplierId)?.name].filter(Boolean).join(' · ')}{i.sentAt ? ' · emailed' : i.payLinkReady ? ' · pay link ready' : ''}</span></td>
                <td>{i.number ? `#${i.number}` : '—'}</td>
                <td>{dayLabel(i.dueDate)}</td>
                <td className="amt">{fmt(i.amountCents)}{i.originalCurrency && i.originalAmountCents && <span className="sub">{fmtCur(i.originalAmountCents, i.originalCurrency)}</span>}</td>
                <td><span className={`pill ${PILL[st]}`}>{st}</span>{st === 'paid' && i.paidDate && <span className="sub">{dayLabel(i.paidDate)}</span>}</td>
                <td className="actions">
                  {kind === 'RECEIVABLE' && i.status !== 'VOID' && <button className="btn small" onClick={() => setSharing(i)}>{i.status === 'OPEN' ? 'Send' : 'View'}</button>}
                  {editor && i.status === 'OPEN' && <button className="btn small" onClick={() => markPaid(i)}>Mark paid</button>}
                  {editor && i.status === 'OPEN' && <button className="btn small" onClick={() => setEditing(i)}>Edit</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    );
  };

  return (
    <>
      <section className="tiles">
        <div className="tile"><span className="k">Owed to you</span><span className="v">{fmt(sum(openR, (i) => i.amountCents))}</span><span className="s">{openR.filter((i) => invStatus(i) === 'overdue').length} overdue</span></div>
        <div className="tile"><span className="k">You owe</span><span className="v">{fmt(sum(openP, (i) => i.amountCents))}</span><span className="s">{openP.filter((i) => invStatus(i) === 'overdue').length} overdue</span></div>
        <div className="tile"><span className="k">Shopify payments</span><span className="v" style={{ fontSize: 18 }}>{shopify.configured ? 'Connected' : 'Not connected'}</span><span className="s">{shopify.configured ? 'Checked every 15 minutes' : 'Ask Manny to add the Shopify keys'}</span></div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <div><h2>Client invoices</h2><p>Build an invoice, send it through Shopify, and it’s marked paid and logged as money in once the client pays.</p></div>
          <div className="row">
            {shopify.configured && <button className="btn" onClick={syncAll} disabled={checking}>{checking ? 'Checking…' : 'Check Shopify payments'}</button>}
            {editor && <button className="btn primary" onClick={() => setEditing({ kind: 'RECEIVABLE' })}>+ New invoice</button>}
          </div>
        </div>
        {table(rec, 'RECEIVABLE')}
      </section>
      <section className="panel">
        <div className="panel-h">
          <div><h2>Bills you owe</h2><p>Supplier and manufacturer bills. Marking one paid logs it as money out.</p></div>
          {editor && <button className="btn" onClick={() => setEditing({ kind: 'PAYABLE' })}>+ New bill</button>}
        </div>
        {table(pay, 'PAYABLE')}
      </section>
      {editing && <InvoiceModal inv={'id' in editing ? editing : null} kind={editing.kind} onClose={() => setEditing(null)} onCreated={(i) => i.kind === 'RECEIVABLE' && setSharing(i)} />}
      {sharing && <ShareModal inv={invoices.find((x) => x.id === sharing.id) || sharing} onClose={() => setSharing(null)} />}
    </>
  );
}

type ItemDraft = { description: string; quantity: string; price: string };

export function InvoiceModal({ inv, kind, onClose, onCreated }: { inv: Invoice | null; kind: Invoice['kind']; onClose: () => void; onCreated: (i: Invoice) => void }) {
  const { settings, reload } = useBooks();
  const toast = useToast();
  const rec = kind === 'RECEIVABLE';
  const cats = rec ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const [party, setParty] = useState(inv?.party || '');
  const [clientEmail, setClientEmail] = useState(inv?.clientEmail || '');
  const [number, setNumber] = useState(inv?.number || '');
  const [category, setCategory] = useState(inv?.category || (rec ? 'Wholesale' : 'Production & Manufacturing'));
  const [line, setLine] = useState(inv?.line || 'Shared');
  const [issueDate, setIssueDate] = useState(inv?.issueDate || today());
  const [dueDate, setDueDate] = useState(inv?.dueDate || addDays(today(), settings?.paymentTermsDays ?? 30));
  const [notes, setNotes] = useState(inv?.notes || '');
  const [money, setMoney] = useState<Money>(moneyFrom(inv?.amountCents, inv?.originalAmountCents, inv?.originalCurrency, inv?.fxRate));
  const [supplierId, setSupplierId] = useState(inv?.supplierId || '');
  const [runId, setRunId] = useState(inv?.runId || '');
  const { runs } = useBooks();
  const [items, setItems] = useState<ItemDraft[]>(
    inv?.items?.length ? inv.items.map((i) => ({ description: i.description, quantity: String(i.quantity), price: centsInput(i.unitPriceCents) })) : [{ description: '', quantity: '1', price: '' }],
  );
  const parsed: Item[] = items.filter((i) => i.description.trim() || i.price.trim()).map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity), unitPriceCents: toCents(i.price) }));
  const total = rec ? sum(parsed, (i) => (Number.isFinite(i.quantity) && Number.isFinite(i.unitPriceCents) ? Math.round(i.quantity * i.unitPriceCents) : 0)) : toCents(money.cad);
  const pickSupplier = (id: string, name?: string) => { setSupplierId(id); if (id && name && !party.trim()) setParty(name); };
  const setItem = (k: number, patch: Partial<ItemDraft>) => setItems((xs) => xs.map((x, j) => (j === k ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!party.trim()) throw new Error(rec ? 'Add the client’s name.' : 'Add the vendor’s name.');
    if (rec) {
      if (!parsed.length) throw new Error('Add at least one line item.');
      for (const it of parsed) {
        if (!it.description) throw new Error('Every line item needs a description.');
        if (!(it.quantity > 0)) throw new Error(`Check the quantity for “${it.description}”.`);
        if (!(it.unitPriceCents >= 0)) throw new Error(`Check the price for “${it.description}”.`);
      }
    }
    if (!(total > 0)) throw new Error('The total must be above zero.');
    const body = rec
      ? { kind, party, clientEmail, number, category, line, issueDate, dueDate, notes, items: parsed }
      : { kind, party, number, category, line, issueDate, dueDate, notes, items: [], ...moneyToBody(money), supplierId: supplierId || null, runId: runId || null };
    if (inv) {
      const r = await api<{ invoice: Invoice; paymentLinkReset: boolean; payLinkError: string | null }>(`/invoices/${inv.id}`, { method: 'PATCH', body });
      await reload();
      toast(r.payLinkError ? `Saved, but the payment link couldn’t be created: ${r.payLinkError}`
        : r.paymentLinkReset ? 'Saved. The payment link was updated to the new total. Resend it so your client has the right amount.' : 'Saved');
    } else {
      const r = await api<{ invoice: Invoice; payLinkError: string | null }>('/invoices', { body });
      await reload();
      toast(r.payLinkError ? `Invoice ${r.invoice.number} created, but the payment link failed: ${r.payLinkError}` : rec ? `Invoice ${r.invoice.number} created with a Shopify payment link` : 'Bill added');
      onCreated(r.invoice);
    }
  };
  const remove = async () => { await api(`/invoices/${inv!.id}`, { method: 'DELETE' }); await reload(); toast('Deleted'); };
  const voidIt = async () => { try { await api(`/invoices/${inv!.id}/void`, { body: {} }); await reload(); toast('Voided'); onClose(); } catch (e: any) { toast(e.message); } };

  return (
    <Modal wide={rec} title={inv ? (rec ? `Edit invoice ${inv.number}` : 'Edit bill') : rec ? 'New invoice' : 'New bill'} onClose={onClose} onSubmit={save} onDelete={inv ? remove : undefined}
      footerExtra={inv && rec ? <button type="button" className="btn" onClick={voidIt}>Void</button> : undefined}>
      <label>{rec ? 'Client name' : 'Vendor'}<input id="i-party" value={party} onChange={(e) => setParty(e.target.value)} autoFocus /></label>
      {rec ? <label>Client email<input id="i-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Where Shopify sends the invoice" /></label>
        : <SupplierSelect value={supplierId} onChange={pickSupplier} id="i-supplier" />}
      {!rec && <MoneyInput value={money} onChange={setMoney} date={issueDate} idPrefix="i" label="Amount owed" />}
      {!rec && (
        <label>Production run<select id="i-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
          <option value="">Not part of a run</option>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>
      )}
      <label>Invoice number<input id="i-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder={rec ? `Auto: ${settings?.invoicePrefix || ''}${settings?.nextInvoiceNumber || ''}` : 'Optional'} /></label>
      <label>Category<select id="i-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Issued<input id="i-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></label>
      <label>Due<input id="i-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      <label>Line<select id="i-line" value={line} onChange={(e) => setLine(e.target.value)}>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
      {rec && (
        <div className="full">
          <span className="hint">Line items</span>
          <table className="items"><tbody>
            {items.map((it, k) => (
              <tr key={k}>
                <td><input aria-label="Description" id={`it-d-${k}`} value={it.description} onChange={(e) => setItem(k, { description: e.target.value })} placeholder="e.g. Custom embroidered hoodies" /></td>
                <td className="q"><input aria-label="Quantity" id={`it-q-${k}`} inputMode="decimal" value={it.quantity} onChange={(e) => setItem(k, { quantity: e.target.value })} /></td>
                <td className="p"><input aria-label="Unit price" id={`it-p-${k}`} inputMode="decimal" value={it.price} onChange={(e) => setItem(k, { price: e.target.value })} placeholder="Unit price" /></td>
                <td className="t">{fmt(Math.round((Number(it.quantity) || 0) * (toCents(it.price) || 0)))}</td>
                <td><button type="button" className="btn small" aria-label="Remove line" onClick={() => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== k) : xs))}>×</button></td>
              </tr>
            ))}
          </tbody></table>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <button type="button" className="btn small" onClick={() => setItems((xs) => [...xs, { description: '', quantity: '1', price: '' }])}>+ Add line</button>
            <b className="num">Total {fmt(total || 0)}</b>
          </div>
        </div>
      )}
      <label className="full">{rec ? 'Note to client' : 'Note'}<textarea id="i-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={rec ? 'Shown on the invoice, e.g. delivery details or thanks' : ''} /></label>
      {rec && !settings?.chargeTax && <p className="hint full">No sales tax is added. Turn on tax in Settings once you’re registered for HST.</p>}
    </Modal>
  );
}

function ShareModal({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const { user } = useAuth();
  const { shopify, reload } = useBooks();
  const toast = useToast();
  const editor = canEdit(user);
  const [busy, setBusy] = useState('');
  const [to, setTo] = useState(inv.clientEmail);
  const [message, setMessage] = useState('');
  const publicUrl = inv.publicToken ? `${location.origin}/pay/${inv.publicToken}` : '';
  const needsLink = inv.status === 'OPEN' && shopify.configured && !inv.payLinkReady;
  const [linkError, setLinkError] = useState('');

  // Make sure the Pay now link exists before the invoice goes anywhere, e.g. invoices
  // saved before Shopify was connected, or whose link failed to create on save.
  const ensureLink = async () => {
    if (!needsLink) return true;
    try { await api(`/invoices/${inv.id}/shopify-link`, { body: {} }); await reload(); setLinkError(''); return true; }
    catch (e: any) { setLinkError(e.message); return false; }
  };
  useEffect(() => { if (needsLink && editor) { setBusy('link'); ensureLink().finally(() => setBusy('')); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shareGuard = async (fn: () => void) => {
    if (needsLink && !(await ensureLink())) { toast('The Pay now button isn’t ready yet, so the client can’t pay online from this link.'); }
    fn();
  };

  const act = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    try { await fn(); await reload(); toast(done); }
    catch (e: any) { toast(e.message); }
    finally { setBusy(''); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast('Couldn’t copy. Select the link and copy it manually.'); }
  };

  return (
    <Modal title={`Invoice ${inv.number} · ${fmt(inv.amountCents)}`} onClose={onClose}>
      <div className="full row"><span className={`pill ${PILL[invStatus(inv)]}`}>{invStatus(inv)}</span><span className="sub">{inv.party} · due {dayLabel(inv.dueDate)}{inv.sentAt ? ` · emailed ${new Date(inv.sentAt).toLocaleDateString('en-CA')}` : ''}</span></div>
      {publicUrl && (
        <label className="full">Invoice page for your client
          <div className="copybox"><input readOnly value={publicUrl} onFocus={(e) => e.target.select()} /><button type="button" className="btn" onClick={() => shareGuard(() => copy(publicUrl))}>Copy</button><a className="btn" href={publicUrl} target="_blank" rel="noreferrer">Open</a></div>
        </label>
      )}
      {inv.status === 'OPEN' && (!shopify.configured ? (
        <p className="hint full">Connect Shopify to add a Pay now button. Until then, the invoice page tells clients to contact you, and you can mark it paid by hand.</p>
      ) : (
        <>
          <div className="full">
            {inv.payLinkReady ? (
              <p className="hint"><span className="pill good">Pay now ready</span> Clients can pay by card from the invoice page or the email.{inv.shopifyInvoiceUrl && <> <a href={inv.shopifyInvoiceUrl} target="_blank" rel="noreferrer">Preview checkout</a></>}</p>
            ) : busy === 'link' ? (
              <p className="hint">Setting up the Shopify payment link…</p>
            ) : (
              <div className="banner warn">
                <span><b>No payment link yet.</b> {linkError || 'Clients won’t see a Pay now button until it’s created.'}</span>
                {editor && <button type="button" className="btn small" onClick={() => { setBusy('link'); ensureLink().finally(() => setBusy('')); }}>Try again</button>}
              </div>
            )}
          </div>
          {editor && (
            <>
              <label className="full">Email the invoice from Shopify to<input id="s-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <label className="full">Message (optional)<textarea id="s-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Hi ${inv.party}, here is invoice ${inv.number}. You can pay securely through the link below.`} /></label>
              <div className="full row">
                <button type="button" className="btn primary" disabled={!!busy || !to} onClick={() => act('send', () => api(`/invoices/${inv.id}/send`, { body: { to, message } }), `Invoice emailed to ${to}`)}>{busy === 'send' ? 'Sending…' : inv.sentAt ? 'Resend invoice email' : 'Send invoice email'}</button>
                {inv.payLinkReady && <button type="button" className="btn" disabled={!!busy} onClick={() => act('check', () => api(`/invoices/${inv.id}/check`, { body: {} }), 'Payment status refreshed')}>{busy === 'check' ? 'Checking…' : 'Check payment'}</button>}
              </div>
              <p className="hint full">Shopify sends the email from your store with the Pay now link. Once the client pays, this invoice is marked paid and logged as money in, usually within 15 minutes.</p>
            </>
          )}
        </>
      ))}
    </Modal>
  );
}

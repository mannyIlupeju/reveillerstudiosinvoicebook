import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fmt, longDate } from '../lib/format';
import type { Item } from '../lib/types';

type Data = {
  business: { name: string; email: string; address: string; footer: string };
  invoice: { number: string; party: string; items: Item[]; amountCents: number; issueDate: string; dueDate: string; status: string; paidDate: string | null; notes: string; payUrl: string | null };
};

// The page clients see. No sign-in; the long random token in the URL is the key.
export default function PublicInvoice() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<Data>(`/public/invoices/${encodeURIComponent(token)}`).then((d) => { setData(d); document.title = `Invoice ${d.invoice.number} · ${d.business.name}`; }).catch((e) => setErr(e.message));
  }, [token]);

  if (err) return <div className="invoice-page"><div className="invoice"><h2>Invoice not found</h2><p className="muted">Check the link you were sent, or contact the sender.</p></div></div>;
  if (!data) return <div className="center muted">Loading invoice…</div>;
  const { business: b, invoice: i } = data;
  const items = i.items?.length ? i.items : [{ description: `Invoice ${i.number}`, quantity: 1, unitPriceCents: i.amountCents }];

  return (
    <div className="invoice-page">
      <article className="invoice">
        <header>
          <div className="biz">
            <h1>{b.name}</h1>
            {b.address && <p>{b.address}</p>}
            {b.email && <p>{b.email}</p>}
          </div>
          <div className="meta">
            <h2>Invoice {i.number}</h2>
            <p>Issued {longDate(i.issueDate)}</p>
            <p>Due {longDate(i.dueDate)}</p>
            <p style={{ marginTop: 8 }}>
              {i.status === 'PAID' ? <span className="pill good">Paid {i.paidDate ? longDate(i.paidDate) : ''}</span>
                : i.status === 'VOID' ? <span className="pill">Cancelled</span>
                : <span className="pill accent">Awaiting payment</span>}
            </p>
          </div>
        </header>
        <div>
          <p className="muted" style={{ margin: '0 0 4px', fontSize: 13 }}>Billed to</p>
          <b>{i.party}</b>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Description</th><th className="amt">Qty</th><th className="amt">Unit price</th><th className="amt">Amount</th></tr></thead>
            <tbody>
              {items.map((it, k) => (
                <tr key={k}><td>{it.description}</td><td className="amt">{it.quantity}</td><td className="amt">{fmt(it.unitPriceCents)}</td><td className="amt">{fmt(Math.round(it.quantity * it.unitPriceCents))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="total"><span>Total (CAD)</span><b>{fmt(i.amountCents)}</b></div>
        {i.notes && <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{i.notes}</p>}
        {i.status === 'OPEN' && (
          <div className="pay noprint">
            {i.payUrl ? (
              <>
                <a className="btn primary" href={i.payUrl} rel="noopener">Pay {fmt(i.amountCents)} now</a>
                <span className="hint">Secure checkout through Shopify. Card and other payment methods accepted.</span>
              </>
            ) : (
              <span className="hint">{b.email ? `To pay, contact ${b.email}.` : 'Payment details will be sent separately.'}</span>
            )}
          </div>
        )}
        <div className="row noprint"><button className="btn small" onClick={() => window.print()}>Print or save as PDF</button></div>
        {b.footer && <footer>{b.footer}</footer>}
      </article>
    </div>
  );
}

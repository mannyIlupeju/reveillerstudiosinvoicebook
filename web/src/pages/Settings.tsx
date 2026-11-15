import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth, useBooks, useToast } from '../lib/store';
import type { Settings } from '../lib/types';

type Log = { id: string; userName: string; summary: string; at: string };

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings, shopify, reload } = useBooks();
  const toast = useToast();
  const owner = user?.role === 'OWNER';
  const [s, setS] = useState<Settings | null>(settings);
  const [logs, setLogs] = useState<Log[]>([]);
  const [pw, setPw] = useState({ current: '', password: '' });

  useEffect(() => { setS(settings); }, [settings]);
  useEffect(() => { api<{ logs: Log[] }>('/activity?limit=60').then((r) => setLogs(r.logs)).catch(() => {}); }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try { await api('/settings', { method: 'PUT', body: s }); await reload(); toast('Settings saved'); } catch (e: any) { toast(e.message); }
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    try { await api('/auth/change-password', { body: pw }); setPw({ current: '', password: '' }); toast('Password changed. Other devices were signed out.'); } catch (e: any) { toast(e.message); }
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => (x ? { ...x, [k]: v } : x));

  return (
    <>
      {s && (
        <section className="panel">
          <div className="panel-h"><div><h2>Business details</h2><p>Shown on the invoices your clients see.</p></div></div>
          <form className="mb" style={{ padding: 0 }} onSubmit={save}>
            <label>Business name<input id="s-name" value={s.businessName} disabled={!owner} onChange={(e) => set('businessName', e.target.value)} /></label>
            <label>Contact email<input id="s-email" type="email" value={s.businessEmail} disabled={!owner} onChange={(e) => set('businessEmail', e.target.value)} /></label>
            <label className="full">Address<textarea id="s-addr" value={s.businessAddress} disabled={!owner} onChange={(e) => set('businessAddress', e.target.value)} /></label>
            <label>Invoice prefix<input id="s-prefix" value={s.invoicePrefix} disabled={!owner} onChange={(e) => set('invoicePrefix', e.target.value)} /></label>
            <label>Next invoice number<input id="s-next" inputMode="numeric" value={s.nextInvoiceNumber} disabled={!owner} onChange={(e) => set('nextInvoiceNumber', Number(e.target.value.replace(/\D/g, '')) || 1)} /></label>
            <label>Default payment terms (days)<input id="s-terms" inputMode="numeric" value={s.paymentTermsDays} disabled={!owner} onChange={(e) => set('paymentTermsDays', Number(e.target.value.replace(/\D/g, '')) || 0)} /></label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}><input type="checkbox" checked={s.chargeTax} disabled={!owner} onChange={(e) => set('chargeTax', e.target.checked)} style={{ minHeight: 0 }} />Let Shopify add sales tax to invoices</label>
            <label className="full">Invoice footer<input id="s-footer" value={s.invoiceFooter} disabled={!owner} onChange={(e) => set('invoiceFooter', e.target.value)} /></label>
            {owner && <div className="full"><button className="btn primary">Save settings</button></div>}
          </form>
        </section>
      )}
      <section className="panel">
        <div className="panel-h"><div><h2>Shopify</h2><p>{shopify.configured ? `Connected to ${shopify.store}. Invoice payments are checked every 15 minutes.` : 'Not connected. Add SHOPIFY_STORE_DOMAIN plus either SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, or SHOPIFY_ADMIN_TOKEN, to the server’s environment.'}</p></div>
          <span className={`pill ${shopify.configured ? 'good' : 'warn'}`}>{shopify.configured ? 'Connected' : 'Not connected'}</span></div>
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Your password</h2></div>
        <form className="row" onSubmit={changePw}>
          <input type="password" aria-label="Current password" placeholder="Current password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          <input type="password" aria-label="New password" placeholder="New password (10+ characters)" autoComplete="new-password" minLength={10} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required />
          <button className="btn">Change password</button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-h"><div><h2>Activity</h2><p>Who changed what, most recent first.</p></div></div>
        {logs.length ? (
          <div className="tablewrap"><table><tbody>
            {logs.map((l) => <tr key={l.id}><td style={{ whiteSpace: 'nowrap' }} className="sub">{new Date(l.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td>{l.userName}</td><td>{l.summary}</td></tr>)}
          </tbody></table></div>
        ) : <div className="empty">No activity yet.</div>}
      </section>
    </>
  );
}

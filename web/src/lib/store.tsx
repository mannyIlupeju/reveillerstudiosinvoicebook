import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Invoice, Rule, Run, Settings, Supplier, Txn, User } from './types';

/* ---------- auth ---------- */
type AuthCtx = { user: User | null; needsSetup: boolean; ready: boolean; setUser: (u: User | null) => void; signOut: () => Promise<void> };
const Auth = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Auth);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api<{ needsSetup: boolean; user: User | null }>('/auth/status')
      .then((r) => { setUser(r.user); setNeedsSetup(r.needsSetup); })
      .catch(() => {})
      .finally(() => setReady(true));
    const out = () => setUser(null);
    window.addEventListener('rb:signed-out', out);
    return () => window.removeEventListener('rb:signed-out', out);
  }, []);
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };
  const set = (u: User | null) => { setUser(u); if (u) setNeedsSetup(false); };
  return <Auth.Provider value={{ user, needsSetup, ready, setUser: set, signOut }}>{children}</Auth.Provider>;
}

export const canEdit = (u: User | null) => u?.role === 'OWNER' || u?.role === 'EDITOR';

/* ---------- books data ---------- */
type BooksCtx = {
  txns: Txn[];
  runs: Run[];
  rules: Rule[];
  invoices: Invoice[];
  suppliers: Supplier[];
  limits: Record<string, number>;
  settings: Settings | null;
  shopify: { configured: boolean; store: string };
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};
const Books = createContext<BooksCtx>(null!);
export const useBooks = () => useContext(Books);

export function BooksProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<BooksCtx, 'reload' | 'loading' | 'error'>>({
    txns: [], runs: [], rules: [], invoices: [], suppliers: [], limits: {}, settings: null, shopify: { configured: false, store: '' },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const [t, r, rec, inv, b, s, sup] = await Promise.all([
        api<{ txns: Txn[] }>('/txns'),
        api<{ runs: Run[] }>('/runs'),
        api<{ rules: Rule[] }>('/recurring'),
        api<{ invoices: Invoice[] }>('/invoices'),
        api<{ limits: Record<string, number> }>('/budgets'),
        api<{ settings: Settings; shopify: { configured: boolean; store: string } }>('/settings'),
        api<{ suppliers: Supplier[] }>('/suppliers'),
      ]);
      if (my !== seq.current) return;
      setState({ txns: t.txns, runs: r.runs, rules: rec.rules, invoices: inv.invoices, suppliers: sup.suppliers, limits: b.limits, settings: s.settings, shopify: s.shopify });
      setError('');
    } catch (e: any) {
      if (my === seq.current) setError(e.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    // Pick up Shopify payments and other people's changes when the tab regains focus.
    const onFocus = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onFocus);
    const t = setInterval(onFocus, 5 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onFocus); clearInterval(t); };
  }, [reload]);

  return <Books.Provider value={{ ...state, loading, error, reload }}>{children}</Books.Provider>;
}

/* ---------- toast ---------- */
const Toast = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Toast);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(''), 3000);
  }, []);
  return (
    <Toast.Provider value={show}>
      {children}
      <div className={`toast ${msg ? 'show' : ''}`} role="status" aria-live="polite">{msg}</div>
    </Toast.Provider>
  );
}

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BooksProvider, canEdit, useAuth, useBooks } from './lib/store';
import { monthOf, today } from './lib/format';
import TxnModal from './components/TxnModal';
import Login from './pages/Login';
import AcceptInvite from './pages/AcceptInvite';
import PublicInvoice from './pages/PublicInvoice';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Runs from './pages/Runs';
import Budgets from './pages/Budgets';
import Recurring from './pages/Recurring';
import Invoices from './pages/Invoices';
import Inventory from './pages/Inventory';
import ImportCsv from './pages/ImportCsv';
import ImportRuns from './pages/ImportRuns';
import Suppliers from './pages/Suppliers';
import ImportSuppliers from './pages/ImportSuppliers';
import Team from './pages/Team';
import SettingsPage from './pages/Settings';
import Orders from './pages/Orders';
import { OrderSummaryProvider, useOrderSummary } from './lib/orders';

const MonthCtx = createContext<[string, (m: string) => void]>(null!);
export const useMonth = () => useContext(MonthCtx);

export const APP_NAME = 'Reveillerstudios CRM';

export default function App() {
  const { ready, user } = useAuth();
  const loc = useLocation();
  if (loc.pathname.startsWith('/pay/')) return <Routes><Route path="/pay/:token" element={<PublicInvoice />} /></Routes>;
  if (loc.pathname.startsWith('/invite/')) return <Routes><Route path="/invite/:token" element={<AcceptInvite />} /></Routes>;
  if (!ready) return <div className="center muted">Loading…</div>;
  if (!user) return <Login />;
  return <BooksProvider><OrderSummaryProvider><Shell /></OrderSummaryProvider></BooksProvider>;
}

const ROLE_LABEL = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' } as const;
const initials = (name: string, email: string) =>
  (name.trim() ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]) : [email[0]]).join('').toUpperCase();

function Shell() {
  const { user } = useAuth();
  const { loading, error } = useBooks();
  const loc = useLocation();
  const month = useState(monthOf(today()));
  const [adding, setAdding] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const editor = canEdit(user);
  const { summary } = useOrderSummary();
  const badges: Record<string, number> = { '/orders': summary?.count || 0 };

  const groups: { label: string; links: [string, string][] }[] = [
    { label: 'Books', links: [['/', 'Dashboard'], ['/transactions', 'Transactions'], ['/invoices', 'Invoices'], ['/budgets', 'Budgets'], ['/recurring', 'Recurring']] },
    { label: 'Shop', links: [['/orders', 'Orders'], ['/inventory', 'Inventory']] },
    { label: 'Production', links: [['/production', 'Production runs'], ['/suppliers', 'Suppliers']] },
    {
      label: 'Studio',
      links: [...(editor ? [['/import', 'Import'] as [string, string]] : []), ...(user?.role === 'OWNER' ? [['/team', 'Team'] as [string, string]] : []), ['/settings', 'Settings']],
    },
  ];
  const current = groups.flatMap((g) => g.links).find(([to]) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)));

  useEffect(() => setNavOpen(false), [loc.pathname]);

  return (
    <MonthCtx.Provider value={month}>
      <div className={`app${navOpen ? ' nav-open' : ''}`}>
        <aside className="side" aria-label="Main">
          <Link to="/" className="logo" aria-label={`${APP_NAME} home`}>
            <img src="/brand/wordmark.svg" alt="Reveillerstudios" />
            <span>CRM</span>
          </Link>
          <nav className="sidenav">
            {groups.map((g) => (
              <div key={g.label} className="navgroup">
                <span className="navlabel">{g.label}</span>
                {g.links.map(([to, label]) => (
                  <NavLink key={to} to={to} end={to === '/'}>
                    {label}
                    {badges[to] > 0 && <span className="navcount" aria-label={`${badges[to]} waiting`}>{badges[to]}</span>}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          {user && <Profile />}
        </aside>
        <button className="scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setNavOpen(false)} />
        <div className="content">
          <header className="top">
            <button className="btn icon menu-btn" aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
            <div className="pagetitle">
              <h1>{current?.[1] ?? APP_NAME}</h1>
              <small>All figures in CAD</small>
            </div>
            <div className="controls">
              <label htmlFor="month" className="hide-sm">Month</label>
              <input type="month" id="month" value={month[0]} onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && month[1](e.target.value)} />
              {editor && <button className="btn primary" onClick={() => setAdding(true)}>+ Add entry</button>}
            </div>
          </header>
          <main>
            {error && <div className="banner crit">{error} <button className="btn small" onClick={() => location.reload()}>Reload</button></div>}
            {loading ? <div className="center muted">Loading…</div> : (
              <Routes>
                <Route path="/" element={<Dashboard onAdd={() => setAdding(true)} />} />
                <Route path="/dashboard" element={<Navigate to="/" />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/production" element={<Runs />} />
                <Route path="/suppliers" element={<Suppliers />} />
                <Route path="/suppliers/import" element={editor ? <ImportSuppliers /> : <Navigate to="/suppliers" />} />
                <Route path="/production/import" element={editor ? <ImportRuns /> : <Navigate to="/production" />} />
                <Route path="/budgets" element={<Budgets />} />
                <Route path="/recurring" element={<Recurring />} />
                <Route path="/import" element={editor ? <ImportCsv /> : <Navigate to="/" />} />
                <Route path="/team" element={user?.role === 'OWNER' ? <Team /> : <Navigate to="/" />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            )}
          </main>
        </div>
      </div>
      {adding && <TxnModal onClose={() => setAdding(false)} />}
    </MonthCtx.Provider>
  );
}

function Profile() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  if (!user) return null;
  return (
    <div className="profile" ref={ref}>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="pm-head">
            <b>{user.name || user.email}</b>
            <span>{user.email}</span>
          </div>
          <Link to="/settings" role="menuitem">Account and password</Link>
          {user.role === 'OWNER' && <Link to="/team" role="menuitem">Manage team</Link>}
          <button role="menuitem" onClick={signOut}>Sign out</button>
        </div>
      )}
      <button className="profile-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden="true">{initials(user.name || '', user.email)}</span>
        <span className="who">
          <b>{user.name || user.email}</b>
          <span>{ROLE_LABEL[user.role]} · signed in</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    </div>
  );
}

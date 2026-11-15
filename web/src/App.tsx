import { createContext, useContext, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BooksProvider, canEdit, useAuth, useBooks } from './lib/store';
import { monthOf, today } from './lib/format';
import TxnModal from './components/TxnModal';
import Login from './pages/Login';
import AcceptInvite from './pages/AcceptInvite';
import PublicInvoice from './pages/PublicInvoice';
import Overview from './pages/Overview';
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

const MonthCtx = createContext<[string, (m: string) => void]>(null!);
export const useMonth = () => useContext(MonthCtx);

export default function App() {
  const { ready, user } = useAuth();
  const loc = useLocation();
  if (loc.pathname.startsWith('/pay/')) return <Routes><Route path="/pay/:token" element={<PublicInvoice />} /></Routes>;
  if (loc.pathname.startsWith('/invite/')) return <Routes><Route path="/invite/:token" element={<AcceptInvite />} /></Routes>;
  if (!ready) return <div className="center muted">Loading…</div>;
  if (!user) return <Login />;
  return <BooksProvider><Shell /></BooksProvider>;
}

function Shell() {
  const { user, signOut } = useAuth();
  const { loading, error } = useBooks();
  const month = useState(monthOf(today()));
  const [adding, setAdding] = useState(false);
  const editor = canEdit(user);
  const tabs: [string, string][] = [
    ['/', 'Overview'], ['/transactions', 'Transactions'], ['/invoices', 'Invoices'], ['/inventory', 'Inventory'], ['/production', 'Production runs'], ['/suppliers', 'Suppliers'],
    ['/budgets', 'Budgets'], ['/recurring', 'Recurring'], ...(editor ? [['/import', 'Import'] as [string, string]] : []),
    ...(user?.role === 'OWNER' ? [['/team', 'Team'] as [string, string]] : []), ['/settings', 'Settings'],
  ];
  return (
    <MonthCtx.Provider value={month}>
      <header className="top">
        <div className="bar">
          <div className="brand">
            <h1>Reveiller Books</h1>
            <small>Reveiller Studios · all figures in CAD</small>
          </div>
          <div className="controls">
            <label htmlFor="month">Month</label>
            <input type="month" id="month" value={month[0]} onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && month[1](e.target.value)} />
            {editor && <button className="btn primary" onClick={() => setAdding(true)}>+ Add entry</button>}
            <button className="btn" onClick={signOut} title={`Signed in as ${user?.email}`}>Sign out</button>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {tabs.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
        </nav>
      </header>
      <main>
        {error && <div className="banner crit">{error} <button className="btn small" onClick={() => location.reload()}>Reload</button></div>}
        {loading ? <div className="center muted">Loading your books…</div> : (
          <Routes>
            <Route path="/" element={<Overview onAdd={() => setAdding(true)} />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/inventory" element={<Inventory />} />
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
      {adding && <TxnModal onClose={() => setAdding(false)} />}
    </MonthCtx.Provider>
  );
}

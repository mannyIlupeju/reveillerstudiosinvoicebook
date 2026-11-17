import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/store';
import type { User } from '../lib/types';

export default function Login() {
  const { needsSetup, setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = needsSetup
        ? await api<{ user: User }>('/auth/setup', { body: { name, email, password, setupToken } })
        : await api<{ user: User }>('/auth/login', { body: { email, password } });
      setUser(r.user);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form onSubmit={submit}>
        <h1><img src="/brand/wordmark.svg" alt="Reveillerstudios" /></h1>
        <span className="tag">CRM</span>
        <p>{needsSetup ? 'Create the owner account. You’ll invite Mabel and Tony from the Team page afterwards.' : 'Sign in to the studio’s CRM.'}</p>
        {needsSetup && (
          <>
            <label className="field">Setup code<input id="setup" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" placeholder="From the server’s SETUP_TOKEN" /></label>
            <label className="field">Your name<input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
          </>
        )}
        <label className="field">Email<input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        <label className="field">Password<input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} minLength={needsSetup ? 10 : undefined} required /></label>
        {needsSetup && <p className="hint">At least 10 characters.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'One moment…' : needsSetup ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/store';
import type { User } from '../lib/types';

export default function AcceptInvite() {
  const { token = '' } = useParams();
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ email: string; role: string }>(`/auth/invite/${encodeURIComponent(token)}`).then(setInvite).catch((e) => setErr(e.message));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ user: User }>('/auth/accept-invite', { body: { token, name, password } });
      setUser(r.user);
      nav('/', { replace: true });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form onSubmit={submit}>
        <h1>Reveiller Books</h1>
        {invite ? (
          <>
            <p>You’ve been invited as {invite.role === 'EDITOR' ? 'an editor' : 'a viewer'} with <b>{invite.email}</b>. Set your name and a password to join.</p>
            <label className="field">Your name<input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
            <label className="field">Password<input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required /></label>
            <p className="hint">At least 10 characters.</p>
            {err && <p className="err" role="alert">{err}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Joining…' : 'Join the books'}</button>
          </>
        ) : err ? (
          <><p className="err">{err}</p><a className="btn" href="/">Go to sign in</a></>
        ) : (
          <p>Checking your invite…</p>
        )}
      </form>
    </div>
  );
}

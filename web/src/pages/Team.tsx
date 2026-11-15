import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/store';
import type { Role, User } from '../lib/types';

type Invite = { id: string; email: string; role: Role; expiresAt: string };
const ROLE: Record<Role, string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };

export default function Team() {
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('EDITOR');
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');

  const load = () => api<{ users: User[]; invites: Invite[] }>('/users').then((r) => { setUsers(r.users); setInvites(r.invites); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api<{ path: string }>('/users/invites', { body: { email, role } });
      setLink(`${location.origin}${r.path}`);
      setEmail('');
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const update = async (u: User, body: Partial<User>) => {
    try { await api(`/users/${u.id}`, { method: 'PATCH', body }); load(); toast('Updated'); } catch (e: any) { toast(e.message); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { toast('Select the link and copy it manually.'); } };

  return (
    <>
      <section className="panel">
        <div className="panel-h"><div><h2>Invite someone</h2><p>Editors can add and change entries, invoices and budgets. Viewers can only look. Invite links work once and expire after 7 days.</p></div></div>
        <form className="row" onSubmit={invite}>
          <input type="email" aria-label="Email" placeholder="mabel@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ flex: 1, minWidth: 220 }} />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option></select>
          <button className="btn primary">Create invite link</button>
        </form>
        {err && <p className="err">{err}</p>}
        {link && (
          <div className="field">Send this link to them by text or email
            <div className="copybox"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn" onClick={copy}>Copy</button></div>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Team</h2></div>
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td>
                <td>{u.role === 'OWNER' ? 'Owner' : (
                  <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => update(u, { role: e.target.value as Role })}><option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option></select>
                )}</td>
                <td><span className={`pill ${u.active ? 'good' : ''}`}>{u.active ? 'Active' : 'Removed'}</span></td>
                <td className="actions">{u.role !== 'OWNER' && <button className="btn small" onClick={() => update(u, { active: !u.active })}>{u.active ? 'Remove access' : 'Restore access'}</button>}</td>
              </tr>
            ))}
            {invites.map((i) => (
              <tr key={i.id}>
                <td className="sub">Invite pending</td><td>{i.email}</td><td>{ROLE[i.role]}</td><td><span className="pill accent">Expires {new Date(i.expiresAt).toLocaleDateString('en-CA')}</span></td>
                <td className="actions"><button className="btn small" onClick={async () => { await api(`/users/invites/${i.id}`, { method: 'DELETE' }); load(); }}>Cancel</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}

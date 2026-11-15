import { Router } from 'express';
import { z } from 'zod';
import { q, one, newId } from '../db.js';
import { ah, parse, HttpError, audit } from '../util.js';
import { requireRole, newToken, hashToken, publicUser } from '../auth.js';

const r = Router();
r.use(requireRole('OWNER'));

r.get('/', ah(async (_req, res) => {
  const users = await q('SELECT * FROM users ORDER BY created_at');
  const invites = await q('SELECT id, email, role, expires_at, created_at FROM invites WHERE used_at IS NULL AND expires_at > now() ORDER BY created_at DESC');
  res.json({ users: users.map(publicUser), invites });
}));

r.post('/invites', ah(async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['EDITOR', 'VIEWER']) }), req.body);
  if (await one('SELECT id FROM users WHERE email = $1', [body.email])) throw new HttpError(409, 'That person already has an account.');
  const token = newToken();
  const invite = await one(
    'INSERT INTO invites (id, email, role, token_hash, expires_at, created_by_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, role, expires_at',
    [newId(), body.email, body.role, hashToken(token), new Date(Date.now() + 7 * 864e5), req.user.id],
  );
  await audit(req.user.id, 'invite', 'user', invite.id, `Invited ${body.email} as ${body.role.toLowerCase()}`);
  res.json({ invite, path: `/invite/${token}` });
}));

r.delete('/invites/:id', ah(async (req, res) => {
  await q('DELETE FROM invites WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

r.patch('/:id', ah(async (req, res) => {
  const body = parse(z.object({ role: z.enum(['EDITOR', 'VIEWER']).optional(), active: z.boolean().optional() }), req.body);
  const user = await one('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user) throw new HttpError(404, 'User not found.');
  if (user.role === 'OWNER') throw new HttpError(400, 'The owner account can’t be changed here.');
  const updated = await one(
    'UPDATE users SET role = COALESCE($2, role), active = COALESCE($3, active) WHERE id = $1 RETURNING *',
    [user.id, body.role ?? null, body.active ?? null],
  );
  if (body.active === false) await q('DELETE FROM sessions WHERE user_id = $1', [user.id]);
  await audit(req.user.id, 'update', 'user', user.id, `${user.name}: ${body.active === false ? 'access removed' : body.active === true ? 'access restored' : `role set to ${String(body.role).toLowerCase()}`}`);
  res.json({ user: publicUser(updated) });
}));

export default r;

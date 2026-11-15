import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, one, tx, newId } from '../db.js';
import { ah, parse, HttpError, audit } from '../util.js';
import { createSession, destroySession, hashToken, publicUser, requireAuth } from '../auth.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Try again in 15 minutes.' } });

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(10, 'must be at least 10 characters').max(200);
const name = z.string().trim().min(1).max(100);
const userCount = async () => (await one('SELECT count(*)::int AS n FROM users')).n;

r.get('/status', ah(async (req, res) => {
  res.json({ needsSetup: (await userCount()) === 0, user: req.user ? publicUser(req.user) : null });
}));

r.post('/setup', limiter, ah(async (req, res) => {
  const body = parse(z.object({ setupToken: z.string().optional(), name, email, password }), req.body);
  const expected = process.env.SETUP_TOKEN;
  if (process.env.NODE_ENV === 'production' && !expected) throw new HttpError(403, 'Setup is locked. Set SETUP_TOKEN on the server first.');
  if (expected) {
    const a = Buffer.from(String(body.setupToken || ''));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'That setup code is not right.');
  }
  const hash = await bcrypt.hash(body.password, 12);
  const user = await tx(async (c) => {
    await c.query('LOCK TABLE users IN EXCLUSIVE MODE');
    if ((await one('SELECT count(*)::int AS n FROM users', [], c)).n > 0) throw new HttpError(409, 'Setup is already done. Sign in instead.');
    return one(`INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,'OWNER') RETURNING *`, [newId(), body.email, body.name, hash], c);
  });
  await createSession(res, user.id);
  await audit(user.id, 'setup', 'user', user.id, `${user.name} created the owner account`);
  res.json({ user: publicUser(user) });
}));

r.post('/login', limiter, ah(async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
  const user = await one('SELECT * FROM users WHERE email = $1', [body.email]);
  const ok = user && user.active && (await bcrypt.compare(body.password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'Email or password is incorrect.');
  await createSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

r.post('/logout', ah(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

const findInvite = (token) => one('SELECT * FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [hashToken(token)]);

r.get('/invite/:token', limiter, ah(async (req, res) => {
  const inv = await findInvite(req.params.token);
  if (!inv) throw new HttpError(404, 'This invite link has expired or was already used. Ask for a new one.');
  res.json({ email: inv.email, role: inv.role });
}));

r.post('/accept-invite', limiter, ah(async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10), name, password }), req.body);
  const hash = await bcrypt.hash(body.password, 12);
  const user = await tx(async (c) => {
    const inv = await one('SELECT * FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE', [hashToken(body.token)], c);
    if (!inv) throw new HttpError(404, 'This invite link has expired or was already used. Ask for a new one.');
    if (await one('SELECT id FROM users WHERE email = $1', [inv.email], c)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    await q('UPDATE invites SET used_at = now() WHERE id = $1', [inv.id], c);
    return one('INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING *', [newId(), inv.email, body.name, hash, inv.role], c);
  });
  await createSession(res, user.id);
  await audit(user.id, 'join', 'user', user.id, `${user.name} joined as ${user.role.toLowerCase()}`);
  res.json({ user: publicUser(user) });
}));

r.post('/change-password', requireAuth, limiter, ah(async (req, res) => {
  const body = parse(z.object({ current: z.string().min(1), password }), req.body);
  if (!(await bcrypt.compare(body.current, req.user.passwordHash))) throw new HttpError(400, 'Your current password is incorrect.');
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(body.password, 12), req.user.id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
  await createSession(res, req.user.id);
  res.json({ ok: true });
}));

export default r;

import crypto from 'node:crypto';
import { q, one, newId } from './db.js';
import { HttpError } from './util.js';

export const SESSION_COOKIE = 'rb_session';
const SESSION_DAYS = 30;

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function createSession(res, userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await q('INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES ($1,$2,$3,$4)', [newId(), hashToken(token), userId, expiresAt]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export async function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Attaches req.user when a valid session cookie is present.
export async function loadUser(req, _res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const u = await one(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
        [hashToken(token)],
      );
      if (u) req.user = u;
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  next();
}

const RANK = { VIEWER: 0, EDITOR: 1, OWNER: 2 };
export const requireRole = (role) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  if (RANK[req.user.role] < RANK[role]) return next(new HttpError(403, 'You don’t have permission to do that.'));
  next();
};

// Mutating API calls must carry this header. Browsers won't send it cross-site
// without a CORS preflight, which this server never approves, so it blocks CSRF.
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'reveiller-books') return next(new HttpError(403, 'Request blocked.'));
  next();
}

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt });

import { q, newId } from './db.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Wrap async route handlers so thrown errors reach the error middleware.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Parse a request body with a zod schema, turning failures into a 400.
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, `${first.path.join('.') || 'input'}: ${first.message}`, r.error.issues);
  }
  return r.data;
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "Today" in the business's time zone (Toronto), not the server's.
export function today(tz = process.env.BUSINESS_TZ || 'America/Toronto') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export function addMonths(s, n, dom) {
  const [y, m] = s.split('-').map(Number);
  let mm = m - 1 + n;
  const yy = y + Math.floor(mm / 12);
  mm = ((mm % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(dom, daysInMonth(yy, mm)))}`;
}

export function nextCycle(s, freq, dom) {
  if (freq === 'weekly') {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 7));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  const n = { monthly: 1, quarterly: 3, yearly: 12 }[freq] || 1;
  return addMonths(s, n, dom || Number(s.slice(8)));
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function audit(userId, action, entity, entityId, summary) {
  try {
    await q('INSERT INTO audit_log (id, user_id, action, entity, entity_id, summary) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), userId || null, action, entity, entityId || null, summary]);
  } catch (e) {
    console.error('audit log failed', e.message);
  }
}

export const money = (cents) => (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

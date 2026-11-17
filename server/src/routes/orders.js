import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, parse, HttpError, audit } from '../util.js';
import { requireRole } from '../auth.js';
import { fetchOrders } from '../orders.js';

const r = Router();
const adminUrl = (id) => {
  const d = (process.env.SHOPIFY_STORE_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return d ? `https://${d.includes('.') ? d : `${d}.myshopify.com`}/admin/orders/${id}` : null;
};

async function withTasks(data) {
  const ids = data.orders.map((o) => o.id);
  const tasks = ids.length ? await q('SELECT * FROM order_tasks WHERE order_id = ANY($1::text[])', [ids]) : [];
  const byId = Object.fromEntries(tasks.map((t) => [t.orderId, t]));
  return {
    ...data,
    orders: data.orders.map((o) => {
      const t = byId[o.id];
      return { ...o, adminUrl: adminUrl(o.id), task: { stage: t?.stage || 'TODO', assignedTo: t?.assignedTo || null, note: t?.note || '', updatedAt: t?.updatedAt || null } };
    }),
  };
}

r.get('/', ah(async (req, res) => {
  const view = req.query.view === 'recent' ? 'recent' : 'open';
  let data;
  try {
    data = await fetchOrders(view, { fresh: req.query.fresh === '1' });
  } catch (e) {
    throw new HttpError(502, e.message);
  }
  const team = await q(`SELECT id, name, email FROM users WHERE active AND role IN ('OWNER','EDITOR') ORDER BY name`);
  res.json({ ...(await withTasks(data)), team });
}));

// Small summary for the sidebar badge and the dashboard. Never fails the page: errors come back as data.
r.get('/summary', ah(async (_req, res) => {
  try {
    const data = await withTasks(await fetchOrders('open'));
    const now = Date.now();
    res.json({
      configured: data.configured,
      count: data.orders.length,
      packed: data.orders.filter((o) => o.task.stage === 'PACKED').length,
      overdue: data.orders.filter((o) => now - Date.parse(o.createdAt) > 3 * 864e5).length,
      orders: data.orders.slice(0, 5),
      error: null,
    });
  } catch (e) {
    res.json({ configured: true, count: 0, packed: 0, overdue: 0, orders: [], error: e.message });
  }
}));

const taskBody = z.object({
  orderName: z.string().trim().min(1).max(40),
  stage: z.enum(['TODO', 'PACKING', 'PACKED']).optional(),
  assignedTo: z.string().nullable().optional(),
  note: z.string().max(2000).optional(),
});
r.put('/:id/task', requireRole('EDITOR'), ah(async (req, res) => {
  if (!/^\d{1,20}$/.test(req.params.id)) throw new HttpError(400, 'Unknown order.');
  const b = parse(taskBody, req.body);
  if (b.assignedTo && !(await one(`SELECT id FROM users WHERE id = $1 AND active`, [b.assignedTo]))) throw new HttpError(400, 'That teammate wasn’t found.');
  const prev = await one('SELECT * FROM order_tasks WHERE order_id = $1', [req.params.id]);
  const next = {
    stage: b.stage ?? prev?.stage ?? 'TODO',
    assignedTo: b.assignedTo !== undefined ? b.assignedTo : prev?.assignedTo ?? null,
    note: b.note ?? prev?.note ?? '',
  };
  const task = await one(
    `INSERT INTO order_tasks (order_id, order_name, stage, assigned_to, note, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (order_id) DO UPDATE SET order_name = $2, stage = $3, assigned_to = $4, note = $5, updated_by = $6, updated_at = now()
     RETURNING *`,
    [req.params.id, b.orderName, next.stage, next.assignedTo, next.note, req.user.id],
  );
  if (b.stage && b.stage !== prev?.stage) await audit(req.user.id, 'update', 'order', req.params.id, `Marked order ${b.orderName} ${({ TODO: 'to pack', PACKING: 'packing', PACKED: 'packed' })[b.stage]}`);
  res.json({ task: { stage: task.stage, assignedTo: task.assignedTo, note: task.note, updatedAt: task.updatedAt } });
}));

export default r;

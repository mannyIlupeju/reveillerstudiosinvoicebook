import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, one, tx, newId } from '../db.js';
import { ah, parse, HttpError, audit, DATE_RE, today } from '../util.js';
import { requireRole } from '../auth.js';
import { EXPENSE_CATEGORIES, LINES, RUN_STATUSES } from '../constants.js';
import { rateFor, CURRENCIES } from '../fx.js';

const r = Router();

const supplierBody = z.object({
  name: z.string().trim().min(1).max(200),
  contact: z.string().trim().max(200).default(''),
  platform: z.string().trim().max(100).default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(200)]).default(''),
  website: z.string().trim().max(300).default(''),
  notes: z.string().trim().max(4000).default(''),
  archived: z.boolean().default(false),
});

// Each supplier with what's been paid to them (CAD), what's still owed on open bills, and run count.
const SELECT_SUPPLIERS = `
  SELECT s.*,
    COALESCE((SELECT sum(amount_cents) FROM transactions t WHERE t.supplier_id = s.id AND t.type = 'EXPENSE'), 0)::bigint AS paid_cents,
    COALESCE((SELECT count(*) FROM transactions t WHERE t.supplier_id = s.id AND t.type = 'EXPENSE'), 0)::int AS payment_count,
    COALESCE((SELECT sum(amount_cents) FROM invoices i WHERE i.supplier_id = s.id AND i.kind = 'PAYABLE' AND i.status = 'OPEN'), 0)::bigint AS owed_cents,
    COALESCE((SELECT count(*) FROM production_runs p WHERE p.supplier_id = s.id), 0)::int AS run_count,
    (SELECT max(date) FROM transactions t WHERE t.supplier_id = s.id) AS last_paid
  FROM suppliers s`;

r.get('/', ah(async (_req, res) => {
  res.json({ suppliers: await q(`${SELECT_SUPPLIERS} ORDER BY s.archived, lower(s.name)`) });
}));

const dupName = async (name, exceptId) => one('SELECT id FROM suppliers WHERE lower(name) = lower($1) AND id <> $2', [name, exceptId || '']);

r.post('/', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(supplierBody, req.body);
  if (await dupName(b.name)) throw new HttpError(409, `There’s already a supplier called “${b.name}”.`);
  const s = await one(
    `INSERT INTO suppliers (id, name, contact, platform, email, website, notes, archived) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [newId(), b.name, b.contact, b.platform, b.email, b.website, b.notes, b.archived],
  );
  await audit(req.user.id, 'create', 'supplier', s.id, `Supplier “${s.name}” added`);
  res.status(201).json({ supplier: s });
}));

r.patch('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const existing = await one('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
  if (!existing) throw new HttpError(404, 'Supplier not found.');
  const b = parse(supplierBody, { ...existing, ...req.body });
  if (await dupName(b.name, existing.id)) throw new HttpError(409, `There’s already a supplier called “${b.name}”.`);
  const s = await one(
    `UPDATE suppliers SET name=$2, contact=$3, platform=$4, email=$5, website=$6, notes=$7, archived=$8 WHERE id=$1 RETURNING *`,
    [existing.id, b.name, b.contact, b.platform, b.email, b.website, b.notes, b.archived],
  );
  await audit(req.user.id, 'update', 'supplier', s.id, `Edited supplier “${s.name}”`);
  res.json({ supplier: s });
}));

r.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const s = await one('DELETE FROM suppliers WHERE id = $1 RETURNING *', [req.params.id]);
  if (s) await audit(req.user.id, 'delete', 'supplier', s.id, `Deleted supplier “${s.name}” (their payments and bills are kept)`);
  res.json({ ok: true });
}));

/* ---------- import supplier orders from a spreadsheet ---------- */
const money$ = z.number().int().positive().max(1e10);
const importRow = z.object({
  supplier: z.string().trim().min(1).max(200),
  contact: z.string().trim().max(200).default(''),
  platform: z.string().trim().max(100).default(''),
  notes: z.string().trim().max(4000).default(''),
  product: z.string().trim().max(200).default(''),
  quantity: z.number().int().positive().max(1e7).nullable().optional(),
  currency: z.enum(CURRENCIES).default('USD'),
  category: z.enum(EXPENSE_CATEGORIES).default('Production & Manufacturing'),
  payment: z.object({ amountCents: money$, date: z.string().regex(DATE_RE) }).nullable().optional(),
  balance: z.object({ amountCents: money$, dueDate: z.string().regex(DATE_RE).nullable().optional() }).nullable().optional(),
  createRun: z.boolean().default(false),
});
r.post('/import', requireRole('EDITOR'), ah(async (req, res) => {
  const { rows, line, runStatus } = parse(z.object({
    rows: z.array(importRow).min(1).max(500),
    line: z.enum(LINES).default('Shared'),
    runStatus: z.enum(RUN_STATUSES).default('In production'),
  }), req.body);

  // Look up every exchange rate first, so a Bank of Canada hiccup fails the whole import cleanly.
  const conv = new Map();
  const convert = async (cents, cur, date) => {
    const key = `${cur}|${date}`;
    if (!conv.has(key)) conv.set(key, await rateFor(cur, date));
    const { rate } = conv.get(key);
    return { cad: Math.round(cents * rate), rate };
  };
  for (const row of rows) {
    if (row.payment) await convert(row.payment.amountCents, row.currency, row.payment.date);
    if (row.balance) await convert(row.balance.amountCents, row.currency, today());
  }

  const out = { suppliers: 0, runs: 0, payments: 0, bills: 0, skipped: [] };
  await tx(async (c) => {
    for (const row of rows) {
      let s = await one('SELECT * FROM suppliers WHERE lower(name) = lower($1)', [row.supplier], c);
      if (!s) {
        s = await one(`INSERT INTO suppliers (id, name, contact, platform, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [newId(), row.supplier, row.contact, row.platform, row.notes], c);
        out.suppliers++;
      } else if (!s.contact && row.contact) {
        await q('UPDATE suppliers SET contact = $2 WHERE id = $1', [s.id, row.contact], c);
      }

      let runId = null;
      if (row.createRun && row.product && row.quantity) {
        const existing = await one('SELECT id FROM production_runs WHERE lower(name) = lower($1)', [row.product], c);
        if (existing) runId = existing.id;
        else {
          runId = (await one(
            `INSERT INTO production_runs (id, name, line, status, units, date, supplier_id, source) VALUES ($1,$2,$3,$4,$5,$6,$7,'IMPORT') RETURNING id`,
            [newId(), row.product, line, runStatus, row.quantity, row.payment?.date || today(), s.id], c)).id;
          out.runs++;
        }
      }

      if (row.payment) {
        const { cad, rate } = await convert(row.payment.amountCents, row.currency, row.payment.date);
        const hash = crypto.createHash('sha256').update(['supplier-import', s.id, row.payment.date, row.payment.amountCents, row.currency, row.product.toLowerCase()].join('|')).digest('hex');
        const ins = await c.query(
          `INSERT INTO transactions (id, type, amount_cents, date, party, category, description, line, run_id, supplier_id,
             original_amount_cents, original_currency, fx_rate, source, import_hash, created_by_id)
           VALUES ($1,'EXPENSE',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'IMPORT',$13,$14) ON CONFLICT (import_hash) DO NOTHING`,
          [newId(), cad, row.payment.date, s.name, row.category, row.product, line, runId, s.id,
            row.currency === 'CAD' ? null : row.payment.amountCents, row.currency === 'CAD' ? null : row.currency, row.currency === 'CAD' ? null : rate, hash, req.user.id],
        );
        if (ins.rowCount) out.payments++; else out.skipped.push(`${s.name} payment on ${row.payment.date} (already imported)`);
      }

      if (row.balance) {
        const note = `Balance for ${row.product || 'order'}`;
        const dup = await one(`SELECT id FROM invoices WHERE supplier_id = $1 AND kind = 'PAYABLE' AND status = 'OPEN' AND notes = $2
          AND COALESCE(original_amount_cents, amount_cents) = $3`, [s.id, note, row.balance.amountCents], c);
        if (dup) { out.skipped.push(`${s.name} balance (already a bill)`); continue; }
        const { cad, rate } = await convert(row.balance.amountCents, row.currency, today());
        await q(
          `INSERT INTO invoices (id, kind, party, amount_cents, category, line, issue_date, due_date, notes, supplier_id,
             original_amount_cents, original_currency, fx_rate, created_by_id, run_id)
           VALUES ($1,'PAYABLE',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [newId(), s.name, cad, row.category, line, today(), row.balance.dueDate || today(),
            note, s.id, row.currency === 'CAD' ? null : row.balance.amountCents, row.currency === 'CAD' ? null : row.currency,
            row.currency === 'CAD' ? null : rate, req.user.id, runId],
          c,
        );
        out.bills++;
      }
    }
  });
  await audit(req.user.id, 'import', 'supplier', null,
    `Supplier import: ${out.suppliers} new supplier(s), ${out.runs} run(s), ${out.payments} payment(s), ${out.bills} bill(s)`);
  res.json(out);
}));

/* ---------- exchange rates ---------- */
export const fxRoutes = Router();
fxRoutes.get('/', ah(async (req, res) => {
  const { currency, date, amountCents } = req.query;
  const rr = await rateFor(String(currency || ''), String(date || today()));
  const cents = Number(amountCents);
  res.json({ ...rr, currency: String(currency).toUpperCase(), cadCents: Number.isFinite(cents) ? Math.round(cents * rr.rate) : null });
}));

export default r;

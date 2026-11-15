import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, one, newId, pool } from '../db.js';
import { ah, parse, HttpError, audit, DATE_RE, money } from '../util.js';
import { requireRole } from '../auth.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LINES } from '../constants.js';

const r = Router();
const MAX_RECEIPT = 6 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECEIPT, files: 1 } });
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

const SELECT_TXN = `
  SELECT t.*, COALESCE((
    SELECT json_agg(json_build_object('id', r.id, 'filename', r.filename, 'mimeType', r.mime_type, 'size', r.size, 'createdAt', r.created_at) ORDER BY r.created_at)
    FROM receipts r WHERE r.transaction_id = t.id), '[]') AS receipts
  FROM transactions t`;

const txnBody = z.object({
  type: z.enum(['EXPENSE', 'INCOME']),
  amountCents: z.number().int().positive().max(1e10),
  date: z.string().regex(DATE_RE, 'must be YYYY-MM-DD'),
  party: z.string().trim().max(200).default(''),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(''),
  line: z.enum(LINES).default('Shared'),
  runId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  originalAmountCents: z.number().int().positive().max(1e10).nullable().optional(),
  originalCurrency: z.enum(['USD', 'EUR', 'GBP', 'CNY']).nullable().optional(),
  fxRate: z.coerce.number().positive().max(1000).nullable().optional(),
}).superRefine((v, ctx) => {
  const list = v.type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (Boolean(v.originalCurrency) !== Boolean(v.originalAmountCents)) ctx.addIssue({ code: 'custom', path: ['originalAmountCents'], message: 'needs both an amount and a currency' });
  if (!list.includes(v.category)) ctx.addIssue({ code: 'custom', path: ['category'], message: 'is not a known category' });
  if (v.type === 'INCOME' && v.runId) ctx.addIssue({ code: 'custom', path: ['runId'], message: 'only expenses can belong to a production run' });
});

function range(qs) {
  const cond = [];
  const params = [];
  if (qs.from && DATE_RE.test(qs.from)) { params.push(qs.from); cond.push(`t.date >= $${params.length}`); }
  if (qs.to && DATE_RE.test(qs.to)) { params.push(qs.to); cond.push(`t.date <= $${params.length}`); }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

const getTxn = (id) => one(`${SELECT_TXN} WHERE t.id = $1`, [id]);

r.get('/', ah(async (req, res) => {
  const { where, params } = range(req.query);
  res.json({ txns: await q(`${SELECT_TXN} ${where} ORDER BY t.date DESC, t.created_at DESC`, params) });
}));

r.get('/export.csv', ah(async (req, res) => {
  const { where, params } = range(req.query);
  const rows = await q(
    `SELECT t.*, pr.name AS run_name, sp.name AS supplier_name, (SELECT count(*)::int FROM receipts r WHERE r.transaction_id = t.id) AS receipt_count
     FROM transactions t LEFT JOIN production_runs pr ON pr.id = t.run_id LEFT JOIN suppliers sp ON sp.id = t.supplier_id ${where} ORDER BY t.date, t.created_at`,
    params,
  );
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Date,Type,Amount CAD,Original amount,Currency,Vendor/Customer,Supplier,Category,Line,Note,Production run,Source,Receipts'];
  for (const t of rows) {
    lines.push([t.date, t.type === 'INCOME' ? 'Money in' : 'Money out', (t.amountCents / 100).toFixed(2),
      t.originalAmountCents ? (t.originalAmountCents / 100).toFixed(2) : '', t.originalCurrency || 'CAD', t.party, t.supplierName || '',
      t.category, t.line, t.description, t.runName || '', t.source.toLowerCase(), t.receiptCount].map(esc).join(','));
  }
  const name = `reveiller-books-${req.query.from || 'all'}${req.query.to ? `-to-${req.query.to}` : ''}.csv`.replace(/[^\w.-]/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + lines.join('\r\n'));
}));

async function checkRun(runId, supplierId) {
  if (runId && !(await one('SELECT id FROM production_runs WHERE id = $1', [runId]))) throw new HttpError(400, 'That production run no longer exists.');
  if (supplierId && !(await one('SELECT id FROM suppliers WHERE id = $1', [supplierId]))) throw new HttpError(400, 'That supplier no longer exists.');
}
const fxCols = (b) => (b.originalCurrency ? [b.originalAmountCents, b.originalCurrency, b.fxRate ?? null] : [null, null, null]);

r.post('/', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(txnBody, req.body);
  await checkRun(b.runId, b.supplierId);
  const id = newId();
  await q(
    `INSERT INTO transactions (id, type, amount_cents, date, party, category, description, line, run_id, supplier_id,
       original_amount_cents, original_currency, fx_rate, source, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'APP',$14)`,
    [id, b.type, b.amountCents, b.date, b.party, b.category, b.description, b.line, b.runId || null, b.supplierId || null, ...fxCols(b), req.user.id],
  );
  await audit(req.user.id, 'create', 'transaction', id, `${b.type === 'INCOME' ? 'Money in' : 'Money out'} ${money(b.amountCents)} ${b.party}`);
  res.status(201).json({ txn: await getTxn(id) });
}));

r.patch('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const existing = await one('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  if (!existing) throw new HttpError(404, 'Entry not found.');
  const b = parse(txnBody, { ...existing, ...req.body });
  await checkRun(b.runId, b.supplierId);
  await q(
    `UPDATE transactions SET type=$2, amount_cents=$3, date=$4, party=$5, category=$6, description=$7, line=$8, run_id=$9, supplier_id=$10,
       original_amount_cents=$11, original_currency=$12, fx_rate=$13, updated_at=now() WHERE id=$1`,
    [existing.id, b.type, b.amountCents, b.date, b.party, b.category, b.description, b.line, b.runId || null, b.supplierId || null, ...fxCols(b)],
  );
  await audit(req.user.id, 'update', 'transaction', existing.id, `Edited ${b.party || 'entry'} (${money(existing.amountCents)} → ${money(b.amountCents)})`);
  res.json({ txn: await getTxn(existing.id) });
}));

r.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const t = await one('DELETE FROM transactions WHERE id = $1 RETURNING *', [req.params.id]);
  if (t) await audit(req.user.id, 'delete', 'transaction', t.id, `Deleted ${t.party || 'entry'} ${money(t.amountCents)} on ${t.date}`);
  res.json({ ok: true });
}));

// Receipts are stored in Postgres so there is no separate file service to run.
r.post('/:id/receipts', requireRole('EDITOR'), upload.single('file'), ah(async (req, res) => {
  const t = await one('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  if (!t) throw new HttpError(404, 'Entry not found.');
  const f = req.file;
  if (!f) throw new HttpError(400, 'Choose a file to upload.');
  if (!RECEIPT_TYPES.includes(f.mimetype)) throw new HttpError(400, 'Receipts must be a photo (JPG, PNG, WebP, HEIC) or a PDF.');
  if ((await one('SELECT count(*)::int AS n FROM receipts WHERE transaction_id = $1', [t.id])).n >= 5) throw new HttpError(400, 'An entry can have at most 5 receipts.');
  const rec = await one(
    `INSERT INTO receipts (id, transaction_id, filename, mime_type, size, data, uploaded_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, filename, mime_type, size, created_at`,
    [newId(), t.id, f.originalname.slice(0, 200), f.mimetype, f.size, f.buffer, req.user.id],
  );
  await audit(req.user.id, 'upload', 'receipt', rec.id, `Receipt added to ${t.party || 'entry'} on ${t.date}`);
  res.status(201).json({ receipt: rec });
}));

export const receipts = Router();
receipts.get('/:id', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT filename, mime_type, data FROM receipts WHERE id = $1', [req.params.id]);
  const rec = rows[0];
  if (!rec) throw new HttpError(404, 'Receipt not found.');
  res.setHeader('Content-Type', rec.mime_type);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${rec.filename.replace(/["\\\r\n]/g, '')}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(rec.data);
}));
receipts.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const rec = await one('DELETE FROM receipts WHERE id = $1 RETURNING id', [req.params.id]);
  if (rec) await audit(req.user.id, 'delete', 'receipt', rec.id, 'Receipt removed');
  res.json({ ok: true });
}));

// Bulk import from a bank CSV. Rows are mapped in the browser; duplicates are skipped by content hash.
export const importer = Router();
const importRow = z.object({
  date: z.string().regex(DATE_RE),
  amountCents: z.number().int().positive().max(1e10),
  type: z.enum(['EXPENSE', 'INCOME']),
  party: z.string().trim().max(200).default(''),
  description: z.string().trim().max(500).default(''),
  category: z.string().trim().max(100),
  line: z.enum(LINES).default('Shared'),
});
importer.post('/', requireRole('EDITOR'), ah(async (req, res) => {
  const body = parse(z.object({ rows: z.array(importRow).min(1).max(5000) }), req.body);
  let imported = 0;
  for (const row of body.rows) {
    const list = row.type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const category = list.includes(row.category) ? row.category : row.type === 'INCOME' ? 'Other Income' : 'Miscellaneous';
    const hash = crypto.createHash('sha256').update([row.date, row.amountCents, row.type, row.party.toLowerCase(), row.description.toLowerCase()].join('|')).digest('hex');
    const res2 = await pool.query(
      `INSERT INTO transactions (id, type, amount_cents, date, party, category, description, line, source, import_hash, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'IMPORT',$9,$10) ON CONFLICT (import_hash) DO NOTHING`,
      [newId(), row.type, row.amountCents, row.date, row.party, category, row.description, row.line, hash, req.user.id],
    );
    imported += res2.rowCount;
  }
  await audit(req.user.id, 'import', 'transaction', null, `Imported ${imported} of ${body.rows.length} rows from CSV`);
  res.json({ imported, skipped: body.rows.length - imported });
}));

export default r;

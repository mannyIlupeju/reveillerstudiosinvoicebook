// Production runs, budgets, recurring rules, settings and the activity log.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx, newId } from '../db.js';
import { ah, parse, HttpError, audit, DATE_RE, money, today } from '../util.js';
import { CURRENCIES, toCad } from '../fx.js';
import { requireRole } from '../auth.js';
import { EXPENSE_CATEGORIES, LINES, FREQUENCIES, RUN_STATUSES, DEFAULT_SETTINGS } from '../constants.js';
import { runJobs } from '../jobs.js';
import { shopifyConfigured } from '../shopify.js';

/* ---------- production runs ---------- */
export const runs = Router();
const runBody = z.object({
  name: z.string().trim().min(1).max(150),
  line: z.enum(LINES).default('RVS'),
  status: z.enum(RUN_STATUSES).default('Planning'),
  units: z.number().int().positive().max(1e7),
  date: z.string().regex(DATE_RE),
  retailPriceCents: z.number().int().nonnegative().nullable().optional(),
  wholesalePriceCents: z.number().int().nonnegative().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  quotedAmountCents: z.number().int().positive().max(1e10).nullable().optional(),
  quotedCurrency: z.enum(CURRENCIES).default('CAD'),
});
// The quote is kept in its own currency; a CAD estimate (today's rate) is stored for unit-cost projections.
async function quotedCad(b) {
  if (!b.quotedAmountCents) return null;
  if (b.quotedCurrency === 'CAD') return b.quotedAmountCents;
  try { return (await toCad(b.quotedAmountCents, b.quotedCurrency, today())).cadCents; } catch { return null; }
}
const SELECT_RUNS = `
  SELECT pr.*, COALESCE((
    SELECT json_agg(json_build_object('id', h.id, 'date', h.date, 'amountCents', h.amount_cents, 'party', h.party,
      'description', h.description, 'category', h.category) ORDER BY h.date NULLS FIRST, h.created_at)
    FROM run_history_costs h WHERE h.run_id = pr.id), '[]') AS history_costs
  FROM production_runs pr`;
runs.get('/', ah(async (_req, res) => res.json({ runs: await q(`${SELECT_RUNS} ORDER BY pr.date DESC, pr.created_at DESC`) })));

// Import past and in-progress runs from a spreadsheet. The browser groups rows into runs;
// each cost line is either recorded on the run only ("history") or added to the books as an
// expense tagged to the run ("books"). Runs whose name already exists are skipped.
const importCost = z.object({
  date: z.string().regex(DATE_RE).nullable().optional(),
  amountCents: z.number().int().positive().max(1e10),
  party: z.string().trim().max(200).default(''),
  description: z.string().trim().max(500).default(''),
  category: z.enum(EXPENSE_CATEGORIES).default('Production & Manufacturing'),
});
const importRun = runBody.extend({
  notes: z.string().trim().max(2000).default(''),
  costs: z.array(importCost).max(500).default([]),
});
runs.post('/import', requireRole('EDITOR'), ah(async (req, res) => {
  const { runs: list, costMode } = parse(z.object({ runs: z.array(importRun).min(1).max(500), costMode: z.enum(['history', 'books']) }), req.body);
  const existing = new Set((await q('SELECT lower(name) AS n FROM production_runs')).map((r) => r.n));
  const created = [];
  const skipped = [];
  await tx(async (c) => {
    for (const r of list) {
      if (existing.has(r.name.toLowerCase())) { skipped.push(r.name); continue; }
      existing.add(r.name.toLowerCase());
      const run = await one(
        `INSERT INTO production_runs (id, name, line, status, units, date, retail_price_cents, wholesale_price_cents, notes, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IMPORT') RETURNING id`,
        [newId(), r.name, r.line, r.status, r.units, r.date, r.retailPriceCents ?? null, r.wholesalePriceCents ?? null, r.notes],
        c,
      );
      for (const k of r.costs) {
        if (costMode === 'books') {
          await q(
            `INSERT INTO transactions (id, type, amount_cents, date, party, category, description, line, run_id, source, created_by_id)
             VALUES ($1,'EXPENSE',$2,$3,$4,$5,$6,$7,$8,'IMPORT',$9)`,
            [newId(), k.amountCents, k.date || r.date, k.party, k.category, k.description, r.line, run.id, req.user.id],
            c,
          );
        } else {
          await q(
            `INSERT INTO run_history_costs (id, run_id, date, amount_cents, party, description, category) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [newId(), run.id, k.date || null, k.amountCents, k.party, k.description, k.category],
            c,
          );
        }
      }
      created.push(r.name);
    }
  });
  if (created.length) await audit(req.user.id, 'import', 'run', null, `Imported ${created.length} production run(s) from a spreadsheet (${costMode === 'books' ? 'costs added to the books' : 'costs kept on the runs only'})`);
  res.json({ created: created.length, skipped });
}));

/* Deposit and final payment on a run's supplier order. Each is a real expense in the books, tagged to the run
   and its supplier and marked DEPOSIT or FINAL. Recording the final payment settles an open bill linked to the run,
   so a balance imported as a bill isn't counted twice. */
const runPayment = z.object({
  amountCents: z.number().int().positive().max(1e10),
  currency: z.enum(CURRENCIES).default('CAD'),
  date: z.string().regex(DATE_RE),
  cadCents: z.number().int().positive().max(1e10).nullable().optional(),
});
runs.put('/:id/payments/:kind', requireRole('EDITOR'), ah(async (req, res) => {
  const kind = String(req.params.kind).toUpperCase();
  if (!['DEPOSIT', 'FINAL'].includes(kind)) throw new HttpError(404, 'Unknown payment.');
  const run = await one('SELECT * FROM production_runs WHERE id = $1', [req.params.id]);
  if (!run) throw new HttpError(404, 'Run not found.');
  const b = parse(runPayment, req.body);
  const supplier = run.supplierId ? await one('SELECT * FROM suppliers WHERE id = $1', [run.supplierId]) : null;
  let cad = b.cadCents;
  let rate = null;
  if (b.currency !== 'CAD') {
    if (!cad) ({ cadCents: cad, rate } = await toCad(b.amountCents, b.currency, b.date));
    else rate = Math.round((cad / b.amountCents) * 1e6) / 1e6;
  } else cad = b.amountCents;
  const orig = b.currency === 'CAD' ? [null, null, null] : [b.amountCents, b.currency, rate];
  const label = kind === 'DEPOSIT' ? 'Deposit' : 'Final payment';

  await tx(async (c) => {
    const existing = await one('SELECT * FROM transactions WHERE run_id = $1 AND run_payment = $2', [run.id, kind], c);
    if (existing) {
      await q(`UPDATE transactions SET amount_cents=$2, date=$3, original_amount_cents=$4, original_currency=$5, fx_rate=$6, supplier_id=COALESCE(supplier_id, $7), updated_at=now() WHERE id=$1`,
        [existing.id, cad, b.date, ...orig, run.supplierId], c);
      return;
    }
    const bill = kind === 'FINAL' ? await one(`SELECT * FROM invoices WHERE run_id = $1 AND kind = 'PAYABLE' AND status = 'OPEN' ORDER BY created_at LIMIT 1`, [run.id], c) : null;
    const txnId = newId();
    await q(
      `INSERT INTO transactions (id, type, amount_cents, date, party, category, description, line, run_id, supplier_id,
         original_amount_cents, original_currency, fx_rate, source, run_payment, invoice_id, created_by_id)
       VALUES ($1,'EXPENSE',$2,$3,$4,'Production & Manufacturing',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [txnId, cad, b.date, supplier?.name || run.name, `${label} · ${run.name}`, run.line, run.id, run.supplierId, ...orig,
        bill ? 'INVOICE' : 'APP', kind, bill?.id || null, req.user.id],
      c,
    );
    if (bill) {
      await q(`UPDATE invoices SET status='PAID', paid_date=$2, updated_at=now() WHERE id=$1`, [bill.id, b.date], c);
    }
  });
  await audit(req.user.id, 'update', 'run', run.id, `${label} for “${run.name}”: ${b.currency === 'CAD' ? money(b.amountCents) : `${b.currency} ${(b.amountCents / 100).toFixed(2)} (${money(cad)})`} on ${b.date}`);
  res.json({ ok: true });
}));
runs.delete('/:id/payments/:kind', requireRole('EDITOR'), ah(async (req, res) => {
  const kind = String(req.params.kind).toUpperCase();
  const t = await one('DELETE FROM transactions WHERE run_id = $1 AND run_payment = $2 RETURNING *', [req.params.id, kind]);
  if (t?.invoiceId) await q(`UPDATE invoices SET status='OPEN', paid_date=NULL WHERE id = $1`, [t.invoiceId]);
  if (t) await audit(req.user.id, 'delete', 'run', req.params.id, `Removed ${kind === 'DEPOSIT' ? 'deposit' : 'final payment'} of ${money(t.amountCents)}${t.invoiceId ? ' (its bill is open again)' : ''}`);
  res.json({ ok: true });
}));

runs.delete('/:id/history-costs/:costId', requireRole('EDITOR'), ah(async (req, res) => {
  const k = await one('DELETE FROM run_history_costs WHERE id = $1 AND run_id = $2 RETURNING *', [req.params.costId, req.params.id]);
  if (k) await audit(req.user.id, 'delete', 'run', req.params.id, `Removed a past cost of ${money(k.amountCents)} from a run`);
  res.json({ ok: true });
}));
runs.post('/', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(runBody, req.body);
  const run = await one(
    `INSERT INTO production_runs (id, name, line, status, units, date, retail_price_cents, wholesale_price_cents, supplier_id,
       quoted_amount_cents, quoted_currency, quoted_cad_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [newId(), b.name, b.line, b.status, b.units, b.date, b.retailPriceCents ?? null, b.wholesalePriceCents ?? null, b.supplierId || null,
      b.quotedAmountCents ?? null, b.quotedCurrency, await quotedCad(b)],
  );
  await audit(req.user.id, 'create', 'run', run.id, `Production run “${run.name}” (${run.units} units)`);
  res.status(201).json({ run: { ...run, historyCosts: [] } });
}));
runs.patch('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const existing = await one('SELECT * FROM production_runs WHERE id = $1', [req.params.id]);
  if (!existing) throw new HttpError(404, 'Run not found.');
  const b = parse(runBody, { ...existing, ...req.body });
  const run = await one(
    `UPDATE production_runs SET name=$2, line=$3, status=$4, units=$5, date=$6, retail_price_cents=$7, wholesale_price_cents=$8, supplier_id=$9,
       quoted_amount_cents=$10, quoted_currency=$11, quoted_cad_cents=$12 WHERE id=$1 RETURNING *`,
    [existing.id, b.name, b.line, b.status, b.units, b.date, b.retailPriceCents ?? null, b.wholesalePriceCents ?? null, b.supplierId || null,
      b.quotedAmountCents ?? null, b.quotedCurrency,
      b.quotedAmountCents === existing.quotedAmountCents && b.quotedCurrency === existing.quotedCurrency && existing.quotedCadCents != null ? existing.quotedCadCents : await quotedCad(b)],
  );
  await audit(req.user.id, 'update', 'run', run.id, `Edited run “${run.name}”`);
  res.json({ run: (await one(`${SELECT_RUNS} WHERE pr.id = $1`, [run.id])) });
}));
runs.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const run = await one('DELETE FROM production_runs WHERE id = $1 RETURNING *', [req.params.id]);
  if (run) await audit(req.user.id, 'delete', 'run', run.id, `Deleted run “${run.name}” (its costs stay in transactions)`);
  res.json({ ok: true });
}));

/* ---------- budgets ---------- */
export const budgets = Router();
budgets.get('/', ah(async (_req, res) => {
  const rows = await q('SELECT * FROM budgets');
  res.json({ limits: Object.fromEntries(rows.map((b) => [b.category, b.limitCents])) });
}));
budgets.put('/', requireRole('EDITOR'), ah(async (req, res) => {
  const { limits } = parse(z.object({ limits: z.record(z.string(), z.number().int().nonnegative().max(1e10)) }), req.body);
  const entries = Object.entries(limits).filter(([c, v]) => EXPENSE_CATEGORIES.includes(c) && v > 0);
  await tx(async (c) => {
    await q('DELETE FROM budgets', [], c);
    for (const [category, cents] of entries) await q('INSERT INTO budgets (category, limit_cents) VALUES ($1,$2)', [category, cents], c);
  });
  await audit(req.user.id, 'update', 'budgets', null, `Budgets updated (${entries.length} categories)`);
  res.json({ limits: Object.fromEntries(entries) });
}));

/* ---------- recurring ---------- */
export const recurring = Router();
const recBody = z.object({
  party: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive().max(1e10),
  frequency: z.enum(FREQUENCIES),
  nextDue: z.string().regex(DATE_RE),
  category: z.enum(EXPENSE_CATEGORIES),
  line: z.enum(LINES).default('Shared'),
  description: z.string().trim().max(300).default(''),
  active: z.boolean().default(true),
});
recurring.get('/', ah(async (_req, res) => res.json({ rules: await q('SELECT * FROM recurring_rules ORDER BY active DESC, next_due') })));
recurring.post('/', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(recBody, req.body);
  const rule = await one(
    `INSERT INTO recurring_rules (id, party, amount_cents, frequency, next_due, day_of_month, category, line, description, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [newId(), b.party, b.amountCents, b.frequency, b.nextDue, Number(b.nextDue.slice(8)), b.category, b.line, b.description, b.active],
  );
  await audit(req.user.id, 'create', 'recurring', rule.id, `Recurring ${rule.party} ${money(rule.amountCents)} ${rule.frequency}`);
  await runJobs();
  res.status(201).json({ rule });
}));
recurring.patch('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const existing = await one('SELECT * FROM recurring_rules WHERE id = $1', [req.params.id]);
  if (!existing) throw new HttpError(404, 'Recurring charge not found.');
  const b = parse(recBody, { ...existing, ...req.body });
  const dom = b.nextDue !== existing.nextDue ? Number(b.nextDue.slice(8)) : existing.dayOfMonth;
  const rule = await one(
    `UPDATE recurring_rules SET party=$2, amount_cents=$3, frequency=$4, next_due=$5, day_of_month=$6, category=$7, line=$8, description=$9, active=$10 WHERE id=$1 RETURNING *`,
    [existing.id, b.party, b.amountCents, b.frequency, b.nextDue, dom, b.category, b.line, b.description, b.active],
  );
  await audit(req.user.id, 'update', 'recurring', rule.id, `${existing.active && !rule.active ? 'Paused' : !existing.active && rule.active ? 'Resumed' : 'Updated'} recurring ${rule.party}`);
  await runJobs();
  res.json({ rule: await one('SELECT * FROM recurring_rules WHERE id = $1', [rule.id]) });
}));
recurring.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const rule = await one('DELETE FROM recurring_rules WHERE id = $1 RETURNING *', [req.params.id]);
  if (rule) await audit(req.user.id, 'delete', 'recurring', rule.id, `Deleted recurring ${rule.party} (past entries kept)`);
  res.json({ ok: true });
}));

/* ---------- settings ---------- */
export async function getSettings(client) {
  const row = await one(`SELECT value FROM settings WHERE key = 'business'`, [], client);
  return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
}
const settingsBody = z.object({
  businessName: z.string().trim().min(1).max(120),
  businessEmail: z.string().trim().max(200),
  businessAddress: z.string().trim().max(400),
  invoicePrefix: z.string().trim().max(20),
  nextInvoiceNumber: z.number().int().positive().max(1e9),
  paymentTermsDays: z.number().int().min(0).max(365),
  chargeTax: z.boolean(),
  invoiceFooter: z.string().trim().max(500),
});
export const settings = Router();
settings.get('/', ah(async (_req, res) => {
  res.json({ settings: await getSettings(), shopify: { configured: shopifyConfigured(), store: process.env.SHOPIFY_STORE_DOMAIN || '' } });
}));
settings.put('/', requireRole('OWNER'), ah(async (req, res) => {
  const body = parse(settingsBody, req.body);
  await q(`INSERT INTO settings (key, value) VALUES ('business', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(body)]);
  await audit(req.user.id, 'update', 'settings', null, 'Business settings updated');
  res.json({ settings: body });
}));

/* ---------- activity ---------- */
export const activity = Router();
activity.get('/', ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const logs = await q(
    `SELECT a.*, CASE WHEN a.user_id IS NULL THEN 'Automatic' ELSE COALESCE(u.name, 'Former member') END AS user_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT $1`,
    [limit],
  );
  res.json({ logs });
}));
activity.post('/run-jobs', requireRole('EDITOR'), ah(async (_req, res) => {
  await runJobs();
  res.json({ ok: true });
}));

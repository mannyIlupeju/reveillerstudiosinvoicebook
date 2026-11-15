import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { q, one, tx, newId } from '../db.js';
import { ah, parse, HttpError, audit, DATE_RE, money, today } from '../util.js';
import { requireRole, newToken } from '../auth.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, LINES, DEFAULT_SETTINGS } from '../constants.js';
import { getSettings } from './misc.js';
import { recordInvoicePayment, syncShopifyInvoices } from '../jobs.js';
import { shopifyConfigured, createDraftOrder, sendDraftOrderInvoice, deleteDraftOrder, verifyWebhook } from '../shopify.js';

const r = Router();

const item = z.object({
  description: z.string().trim().min(1).max(255),
  quantity: z.number().positive().max(1e6),
  unitPriceCents: z.number().int().nonnegative().max(1e10),
});
const invBody = z.object({
  kind: z.enum(['RECEIVABLE', 'PAYABLE']),
  number: z.string().trim().max(40).default(''),
  party: z.string().trim().min(1).max(200),
  clientEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(200)]).default(''),
  items: z.array(item).max(100).default([]),
  amountCents: z.number().int().nonnegative().max(1e10).optional(),
  category: z.string().trim().min(1).max(100),
  line: z.enum(LINES).default('Shared'),
  issueDate: z.string().regex(DATE_RE),
  dueDate: z.string().regex(DATE_RE),
  notes: z.string().trim().max(2000).default(''),
}).superRefine((v, ctx) => {
  const list = v.kind === 'RECEIVABLE' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!list.includes(v.category)) ctx.addIssue({ code: 'custom', path: ['category'], message: 'is not a known category' });
  if (!v.items.length && !(v.amountCents > 0)) ctx.addIssue({ code: 'custom', path: ['amountCents'], message: 'add line items or an amount' });
});
const totalOf = (items) => items.reduce((a, it) => a + Math.round(it.quantity * it.unitPriceCents), 0);

// Never send internal ids or Shopify ids to the browser beyond what the UI needs.
const shape = (inv) => {
  const { createdById, ...rest } = inv;
  return { ...rest, payLinkReady: Boolean(inv.shopifyInvoiceUrl) };
};
const load = async (id, c) => {
  const inv = await one('SELECT * FROM invoices WHERE id = $1', [id], c);
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  return inv;
};

r.get('/', ah(async (_req, res) => {
  res.json({ invoices: (await q('SELECT * FROM invoices ORDER BY due_date, created_at')).map(shape) });
}));

async function allocateNumber(c) {
  await q(`INSERT INTO settings (key, value) VALUES ('business', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(DEFAULT_SETTINGS)], c);
  const row = await one(`SELECT value FROM settings WHERE key = 'business' FOR UPDATE`, [], c);
  const s = { ...DEFAULT_SETTINGS, ...row.value };
  await q(`UPDATE settings SET value = $1 WHERE key = 'business'`, [JSON.stringify({ ...s, nextInvoiceNumber: s.nextInvoiceNumber + 1 })], c);
  return `${s.invoicePrefix}${s.nextInvoiceNumber}`;
}

r.post('/', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(invBody, req.body);
  const amountCents = b.items.length ? totalOf(b.items) : b.amountCents;
  if (!(amountCents > 0)) throw new HttpError(400, 'The invoice total must be above zero.');
  const inv = await tx(async (c) => {
    const number = b.number || (b.kind === 'RECEIVABLE' ? await allocateNumber(c) : '');
    return one(
      `INSERT INTO invoices (id, kind, number, party, client_email, items, amount_cents, category, line, issue_date, due_date, notes, public_token, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [newId(), b.kind, number, b.party, b.clientEmail, JSON.stringify(b.items), amountCents, b.category, b.line, b.issueDate, b.dueDate, b.notes,
        b.kind === 'RECEIVABLE' ? newToken() : null, req.user.id],
      c,
    );
  });
  await audit(req.user.id, 'create', 'invoice', inv.id, `${inv.kind === 'RECEIVABLE' ? 'Invoice' : 'Bill'} ${inv.number} ${inv.party} ${money(inv.amountCents)}`);
  res.status(201).json({ invoice: shape(inv) });
}));

r.patch('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const existing = await load(req.params.id);
  if (existing.status === 'PAID') throw new HttpError(400, 'Paid invoices can’t be edited. Delete the payment entry first if it was a mistake.');
  const b = parse(invBody, { ...existing, ...req.body, kind: existing.kind });
  const amountCents = b.items.length ? totalOf(b.items) : b.amountCents;
  if (!(amountCents > 0)) throw new HttpError(400, 'The invoice total must be above zero.');
  // A Shopify checkout locks in the old amount, so drop it when the total or items change.
  const changed = Boolean(existing.shopifyDraftOrderId) && (amountCents !== existing.amountCents || JSON.stringify(b.items) !== JSON.stringify(existing.items));
  if (changed) {
    try { await deleteDraftOrder(existing.shopifyDraftOrderId); } catch (e) { console.error('draft order delete failed', e.message); }
  }
  const inv = await one(
    `UPDATE invoices SET number=$2, party=$3, client_email=$4, items=$5, amount_cents=$6, category=$7, line=$8, issue_date=$9, due_date=$10, notes=$11, updated_at=now()
       ${changed ? ', shopify_draft_order_id = NULL, shopify_invoice_url = NULL, sent_at = NULL' : ''}
     WHERE id = $1 RETURNING *`,
    [existing.id, b.number, b.party, b.clientEmail, JSON.stringify(b.items), amountCents, b.category, b.line, b.issueDate, b.dueDate, b.notes],
  );
  await audit(req.user.id, 'update', 'invoice', inv.id, `Edited ${inv.number || 'bill'} ${inv.party}${changed ? ' (payment link reset)' : ''}`);
  res.json({ invoice: shape(inv), paymentLinkReset: changed });
}));

r.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const inv = await one('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (!inv) return res.json({ ok: true });
  if (inv.shopifyDraftOrderId && inv.status !== 'PAID') {
    try { await deleteDraftOrder(inv.shopifyDraftOrderId); } catch (e) { console.error('draft order delete failed', e.message); }
  }
  await q('DELETE FROM invoices WHERE id = $1', [inv.id]);
  await audit(req.user.id, 'delete', 'invoice', inv.id, `Deleted ${inv.number || 'bill'} ${inv.party} (any payment entry is kept)`);
  res.json({ ok: true });
}));

r.post('/:id/pay', requireRole('EDITOR'), ah(async (req, res) => {
  const { date } = parse(z.object({ date: z.string().regex(DATE_RE).optional() }), req.body || {});
  const inv = await load(req.params.id);
  if (inv.status !== 'OPEN') throw new HttpError(400, inv.status === 'PAID' ? 'Already marked paid.' : 'This invoice was voided.');
  await recordInvoicePayment(inv, { date: date || today(), userId: req.user.id });
  res.json({ invoice: shape(await load(inv.id)) });
}));

r.post('/:id/void', requireRole('EDITOR'), ah(async (req, res) => {
  const inv = await load(req.params.id);
  if (inv.status === 'PAID') throw new HttpError(400, 'Paid invoices can’t be voided.');
  if (inv.shopifyDraftOrderId) {
    try { await deleteDraftOrder(inv.shopifyDraftOrderId); } catch (e) { console.error('draft order delete failed', e.message); }
  }
  const updated = await one(`UPDATE invoices SET status='VOID', shopify_draft_order_id=NULL, shopify_invoice_url=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [inv.id]);
  await audit(req.user.id, 'void', 'invoice', inv.id, `Voided ${inv.number} ${inv.party}`);
  res.json({ invoice: shape(updated) });
}));

async function ensurePayLink(inv) {
  if (inv.kind !== 'RECEIVABLE') throw new HttpError(400, 'Payment links are only for invoices you send to clients.');
  if (inv.status !== 'OPEN') throw new HttpError(400, 'This invoice is not open.');
  if (inv.shopifyDraftOrderId && inv.shopifyInvoiceUrl) return inv;
  if (!shopifyConfigured()) throw new HttpError(400, 'Shopify isn’t connected yet. Add the Shopify settings on the server, then try again.');
  const { chargeTax } = await getSettings();
  let d;
  try { d = await createDraftOrder(inv, { chargeTax }); } catch (e) { throw new HttpError(502, e.message); }
  return one(
    `UPDATE invoices SET shopify_draft_order_id=$2, shopify_invoice_url=$3, public_token=COALESCE(public_token, $4), updated_at=now() WHERE id=$1 RETURNING *`,
    [inv.id, d.id, d.invoiceUrl, newToken()],
  );
}

r.post('/:id/shopify-link', requireRole('EDITOR'), ah(async (req, res) => {
  const inv = await ensurePayLink(await load(req.params.id));
  await audit(req.user.id, 'link', 'invoice', inv.id, `Shopify payment link created for ${inv.number}`);
  res.json({ invoice: shape(inv) });
}));

r.post('/:id/send', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(z.object({ to: z.string().trim().toLowerCase().email().optional(), message: z.string().trim().max(2000).default('') }), req.body || {});
  let inv = await load(req.params.id);
  const to = b.to || inv.clientEmail;
  if (!to) throw new HttpError(400, 'Add the client’s email address first.');
  inv = await ensurePayLink(inv);
  const s = await getSettings();
  try {
    await sendDraftOrderInvoice(inv.shopifyDraftOrderId, {
      to,
      subject: `Invoice ${inv.number} from ${s.businessName}`,
      message: b.message || `Hi ${inv.party}, here is invoice ${inv.number} for ${money(inv.amountCents)}, due ${inv.dueDate}. You can pay securely through the link below.`,
    });
  } catch (e) { throw new HttpError(502, e.message); }
  inv = await one('UPDATE invoices SET sent_at = now(), client_email = $2, updated_at = now() WHERE id = $1 RETURNING *', [inv.id, to]);
  await audit(req.user.id, 'send', 'invoice', inv.id, `Emailed ${inv.number} to ${to} via Shopify`);
  res.json({ invoice: shape(inv) });
}));

r.post('/:id/check', ah(async (req, res) => {
  const inv = await load(req.params.id);
  if (inv.shopifyDraftOrderId && inv.status === 'OPEN') await syncShopifyInvoices(inv.id);
  res.json({ invoice: shape(await load(inv.id)) });
}));

r.post('/sync', ah(async (_req, res) => {
  res.json({ paid: await syncShopifyInvoices() });
}));

/* ---------- public client-facing invoice ---------- */
export const publicInvoices = Router();
publicInvoices.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
publicInvoices.get('/:token', ah(async (req, res) => {
  if (!req.params.token || req.params.token.length < 20) throw new HttpError(404, 'Invoice not found.');
  const inv = await one(`SELECT * FROM invoices WHERE public_token = $1 AND kind = 'RECEIVABLE'`, [req.params.token]);
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  const s = await getSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    business: { name: s.businessName, email: s.businessEmail, address: s.businessAddress, footer: s.invoiceFooter },
    invoice: {
      number: inv.number, party: inv.party, items: inv.items, amountCents: inv.amountCents, issueDate: inv.issueDate,
      dueDate: inv.dueDate, status: inv.status, paidDate: inv.paidDate, notes: inv.notes,
      payUrl: inv.status === 'OPEN' ? inv.shopifyInvoiceUrl : null,
    },
  });
}));

/* ---------- Shopify webhook: a signed draft order or order update triggers a payment sync ---------- */
export async function shopifyWebhook(req, res) {
  if (!verifyWebhook(req.body, req.get('x-shopify-hmac-sha256'))) return res.status(401).end();
  res.status(200).end();
  syncShopifyInvoices().catch((e) => console.error('webhook sync failed', e.message));
}

export default r;

import { q, tx, newId, isUniqueViolation } from './db.js';
import { today, nextCycle, audit, money } from './util.js';
import { shopifyConfigured, draftOrderPaymentStatus } from './shopify.js';
import { syncInventory } from './inventory.js';

// Log every recurring charge that has come due. Safe to run repeatedly and from
// several processes at once: each charge has a unique recurring_key.
export async function runRecurring() {
  const t = today();
  const rules = await q('SELECT * FROM recurring_rules WHERE active AND next_due <= $1', [t]);
  let logged = 0;
  for (const r of rules) {
    let due = r.nextDue;
    let guard = 0;
    while (due <= t && guard < 120) {
      try {
        await q(
          `INSERT INTO transactions (id, type, amount_cents, date, party, category, description, line, source, recurring_key)
           VALUES ($1,'EXPENSE',$2,$3,$4,$5,$6,$7,'RECURRING',$8)`,
          [newId(), r.amountCents, due, r.party, r.category, r.description || `${r.frequency} charge`, r.line, `${r.id}:${due}`],
        );
        logged++;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e; // already logged
      }
      due = nextCycle(due, r.frequency, r.dayOfMonth);
      guard++;
    }
    await q('UPDATE recurring_rules SET next_due = $1 WHERE id = $2 AND next_due = $3', [due, r.id, r.nextDue]);
  }
  if (logged) await audit(null, 'auto', 'recurring', null, `Logged ${logged} recurring charge(s)`);
  return logged;
}

// Record an invoice as paid and log the payment as a transaction. Idempotent per invoice.
export async function recordInvoicePayment(inv, { date, source = 'INVOICE', userId = null, orderName = null, orderId = null } = {}) {
  const paidDate = date || today();
  const type = inv.kind === 'RECEIVABLE' ? 'INCOME' : 'EXPENSE';
  const description = [inv.number ? `Invoice ${inv.number}` : 'Invoice payment', orderName ? `Shopify ${orderName}` : ''].filter(Boolean).join(' · ');
  await tx(async (c) => {
    await q(
      `INSERT INTO transactions (id, type, amount_cents, date, party, category, description, line, source, invoice_id, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (invoice_id) DO NOTHING`,
      [newId(), type, inv.amountCents, paidDate, inv.party, inv.category, description, inv.line, source, inv.id, userId],
      c,
    );
    await q(
      `UPDATE invoices SET status = 'PAID', paid_date = $2, shopify_order_id = COALESCE($3, shopify_order_id), updated_at = now() WHERE id = $1`,
      [inv.id, paidDate, orderId],
      c,
    );
  });
  await audit(userId, 'paid', 'invoice', inv.id, `${inv.party} ${money(inv.amountCents)} marked paid${source === 'SHOPIFY' ? ' via Shopify' : ''}`);
}

// Ask Shopify whether any open invoices with a draft order have been paid.
export async function syncShopifyInvoices(onlyId) {
  if (!shopifyConfigured()) return 0;
  const open = onlyId
    ? await q(`SELECT * FROM invoices WHERE id = $1 AND kind = 'RECEIVABLE' AND status = 'OPEN' AND shopify_draft_order_id IS NOT NULL`, [onlyId])
    : await q(`SELECT * FROM invoices WHERE kind = 'RECEIVABLE' AND status = 'OPEN' AND shopify_draft_order_id IS NOT NULL`);
  let paid = 0;
  for (const inv of open) {
    try {
      const s = await draftOrderPaymentStatus(inv.shopifyDraftOrderId);
      if (s.paid) {
        const date = s.paidAt ? new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TZ || 'America/Toronto' }).format(new Date(s.paidAt)) : today();
        await recordInvoicePayment(inv, { date, source: 'SHOPIFY', orderName: s.orderName, orderId: s.orderId });
        paid++;
      }
    } catch (e) {
      console.error(`Shopify sync failed for invoice ${inv.id}:`, e.message);
    }
  }
  return paid;
}

let running = false;
export async function runJobs() {
  if (running) return;
  running = true;
  try {
    const r = await runRecurring();
    const p = await syncShopifyInvoices();
    await syncInventory();
    await q('DELETE FROM sessions WHERE expires_at < now()');
    if (r || p) console.log(`jobs: ${r} recurring logged, ${p} Shopify payments recorded`);
  } catch (e) {
    console.error('jobs failed:', e);
  } finally {
    running = false;
  }
}

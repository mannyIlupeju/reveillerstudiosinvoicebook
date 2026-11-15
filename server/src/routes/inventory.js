import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, parse, HttpError, audit, money } from '../util.js';
import { requireRole } from '../auth.js';
import { syncInventory, syncStatus } from '../inventory.js';
import { shopifyConfigured } from '../shopify.js';

const r = Router();

r.get('/', ah(async (_req, res) => {
  const items = await q(`SELECT * FROM inventory_items WHERE NOT removed ORDER BY product_title, variant_title`);
  res.json({ items, sync: syncStatus(), configured: shopifyConfigured() });
}));

r.post('/sync', requireRole('EDITOR'), ah(async (req, res) => {
  if (!shopifyConfigured()) throw new HttpError(400, 'Shopify isn’t connected yet.');
  const s = await syncInventory();
  if (!s.ok) throw new HttpError(502, s.error || 'Sync failed.');
  await audit(req.user.id, 'sync', 'inventory', null, `Synced ${s.count} variants from Shopify`);
  res.json({ sync: s });
}));

r.patch('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(z.object({
    unitCostCents: z.number().int().nonnegative().max(1e9).nullable().optional(),
    runId: z.string().nullable().optional(),
    lowStockAt: z.number().int().min(0).max(1e6).nullable().optional(),
    applyToProduct: z.boolean().optional(),
  }), req.body);
  const item = await one('SELECT * FROM inventory_items WHERE shopify_variant_id = $1', [req.params.id]);
  if (!item) throw new HttpError(404, 'Item not found. Try syncing again.');
  if (b.runId && !(await one('SELECT id FROM production_runs WHERE id = $1', [b.runId]))) throw new HttpError(400, 'That production run no longer exists.');
  const next = {
    unitCostCents: b.unitCostCents !== undefined ? b.unitCostCents : item.unitCostCents,
    runId: b.runId !== undefined ? b.runId : item.runId,
    lowStockAt: b.lowStockAt !== undefined ? b.lowStockAt : item.lowStockAt,
  };
  // "Apply to all sizes": the same cost, run and low-stock level for every variant of the product.
  const where = b.applyToProduct ? 'shopify_product_id = $1' : 'shopify_variant_id = $1';
  const key = b.applyToProduct ? item.shopifyProductId : item.shopifyVariantId;
  const updated = await q(
    `UPDATE inventory_items SET unit_cost_cents = $2, run_id = $3, low_stock_at = $4 WHERE ${where} RETURNING *`,
    [key, next.unitCostCents, next.runId || null, next.lowStockAt],
  );
  const name = b.applyToProduct ? `${item.productTitle} (all variants)` : [item.productTitle, item.variantTitle].filter(Boolean).join(' – ');
  await audit(req.user.id, 'update', 'inventory', item.shopifyVariantId,
    `${name}: ${next.unitCostCents != null ? `unit cost ${money(next.unitCostCents)}` : 'unit cost cleared'}${next.runId ? ', linked to a run' : ''}`);
  res.json({ items: updated });
}));

export default r;

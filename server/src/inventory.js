import { q, tx } from './db.js';
import { shopifyConfigured, fetchAllVariants } from './shopify.js';

const cents = (amount) => (amount == null || amount === '' ? null : Math.round(Number(amount) * 100));

let lastSync = { at: null, ok: null, error: null, count: 0 };
export const syncStatus = () => lastSync;

// Mirror Shopify's variants into inventory_items. Values set in the app (unit cost,
// linked run, low-stock level) are never touched. Variants deleted in Shopify are
// marked removed rather than deleted, so their history stays readable.
export async function syncInventory() {
  if (!shopifyConfigured()) return { skipped: true };
  try {
    const variants = await fetchAllVariants();
    await tx(async (c) => {
      for (const v of variants) {
        await q(
          `INSERT INTO inventory_items
             (shopify_variant_id, shopify_product_id, product_title, variant_title, sku, product_type, product_status,
              image_url, price_cents, quantity, tracked, shopify_unit_cost_cents, removed, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,now())
           ON CONFLICT (shopify_variant_id) DO UPDATE SET
             shopify_product_id = EXCLUDED.shopify_product_id, product_title = EXCLUDED.product_title,
             variant_title = EXCLUDED.variant_title, sku = EXCLUDED.sku, product_type = EXCLUDED.product_type,
             product_status = EXCLUDED.product_status, image_url = EXCLUDED.image_url, price_cents = EXCLUDED.price_cents,
             quantity = EXCLUDED.quantity, tracked = EXCLUDED.tracked, shopify_unit_cost_cents = EXCLUDED.shopify_unit_cost_cents,
             removed = false, synced_at = now()`,
          [
            v.id, v.product.id, v.product.title, v.title === 'Default Title' ? '' : v.title, v.sku || '',
            v.product.productType || '', v.product.status, v.product.featuredMedia?.preview?.image?.url || null,
            cents(v.price) || 0, v.inventoryQuantity ?? 0, v.inventoryItem?.tracked ?? true, cents(v.inventoryItem?.unitCost?.amount),
          ],
          c,
        );
      }
      const ids = variants.map((v) => v.id);
      await q(`UPDATE inventory_items SET removed = true WHERE NOT (shopify_variant_id = ANY($1::text[]))`, [ids], c);
    });
    lastSync = { at: new Date().toISOString(), ok: true, error: null, count: variants.length };
  } catch (e) {
    lastSync = { ...lastSync, at: new Date().toISOString(), ok: false, error: e.message };
    console.error('inventory sync failed:', e.message);
  }
  return lastSync;
}

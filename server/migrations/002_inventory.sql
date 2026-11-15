-- Inventory mirrored from Shopify, one row per product variant.
-- Columns prefixed shopify_ are overwritten on every sync; the others are set in the app and kept.
CREATE TABLE inventory_items (
  shopify_variant_id       text PRIMARY KEY,
  shopify_product_id       text NOT NULL,
  product_title            text NOT NULL,
  variant_title            text NOT NULL DEFAULT '',
  sku                      text NOT NULL DEFAULT '',
  product_type             text NOT NULL DEFAULT '',
  product_status           text NOT NULL DEFAULT 'ACTIVE',
  image_url                text,
  price_cents              bigint NOT NULL DEFAULT 0,
  quantity                 integer NOT NULL DEFAULT 0,
  tracked                  boolean NOT NULL DEFAULT true,
  shopify_unit_cost_cents  bigint,
  removed                  boolean NOT NULL DEFAULT false,
  synced_at                timestamptz NOT NULL DEFAULT now(),
  -- Set in Reveiller Books
  unit_cost_cents          bigint,
  run_id                   text REFERENCES production_runs(id) ON DELETE SET NULL,
  low_stock_at             integer
);
CREATE INDEX inventory_items_product_idx ON inventory_items(shopify_product_id);

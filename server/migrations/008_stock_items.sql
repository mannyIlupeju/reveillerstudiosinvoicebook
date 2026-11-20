-- Items added to inventory by hand in the app (finished pieces, samples, materials, trims),
-- alongside the variants mirrored from Shopify.
CREATE TABLE stock_items (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  category         text NOT NULL DEFAULT 'Finished goods',
  size             text NOT NULL DEFAULT '',
  colour           text NOT NULL DEFAULT '',
  quantity         integer NOT NULL DEFAULT 0,
  price_cents      bigint,                         -- in the item's currency
  currency         text NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD', 'USD')),
  price_cad_cents  bigint,                         -- converted at the Bank of Canada rate when saved
  fx_rate          numeric,
  price_kind       text NOT NULL DEFAULT 'COST' CHECK (price_kind IN ('COST', 'RETAIL')),
  supplier_id      text REFERENCES suppliers(id) ON DELETE SET NULL,
  sku              text NOT NULL DEFAULT '',
  notes            text NOT NULL DEFAULT '',
  created_by_id    text REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_photos (
  id              text PRIMARY KEY,
  item_id         text NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size            integer NOT NULL,
  data            bytea NOT NULL,
  uploaded_by_id  text REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_photos_item_idx ON stock_photos(item_id, created_at);

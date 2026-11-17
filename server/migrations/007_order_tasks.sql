-- The team's fulfilment notes on Shopify orders. Orders themselves (items, customer,
-- address) are read live from Shopify and never stored here.
CREATE TABLE order_tasks (
  order_id      text PRIMARY KEY,            -- Shopify order legacy id
  order_name    text NOT NULL,               -- e.g. #1022, for the activity log
  stage         text NOT NULL DEFAULT 'TODO' CHECK (stage IN ('TODO', 'PACKING', 'PACKED')),
  assigned_to   text REFERENCES users(id) ON DELETE SET NULL,
  note          text NOT NULL DEFAULT '',
  updated_by    text REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

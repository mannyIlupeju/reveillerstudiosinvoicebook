-- Suppliers, and amounts paid in a foreign currency.
CREATE TABLE suppliers (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  contact    text NOT NULL DEFAULT '',
  platform   text NOT NULL DEFAULT '',
  email      text NOT NULL DEFAULT '',
  website    text NOT NULL DEFAULT '',
  notes      text NOT NULL DEFAULT '',
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_idx ON suppliers (lower(name));

ALTER TABLE transactions    ADD COLUMN supplier_id text REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE invoices        ADD COLUMN supplier_id text REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE production_runs ADD COLUMN supplier_id text REFERENCES suppliers(id) ON DELETE SET NULL;
-- A bill can belong to a production run; paying it tags the payment to that run.
ALTER TABLE invoices        ADD COLUMN run_id text REFERENCES production_runs(id) ON DELETE SET NULL;
CREATE INDEX transactions_supplier_idx ON transactions(supplier_id);

-- The amount as charged (e.g. 42475 USD cents) and the rate used to get amount_cents in CAD.
ALTER TABLE transactions ADD COLUMN original_amount_cents bigint;
ALTER TABLE transactions ADD COLUMN original_currency text;
ALTER TABLE transactions ADD COLUMN fx_rate numeric(12,6);
ALTER TABLE invoices     ADD COLUMN original_amount_cents bigint;
ALTER TABLE invoices     ADD COLUMN original_currency text;
ALTER TABLE invoices     ADD COLUMN fx_rate numeric(12,6);

-- Bank of Canada daily rates, cached: 1 unit of currency = rate CAD.
CREATE TABLE fx_rates (
  currency text NOT NULL,
  date     text NOT NULL,
  rate     numeric(12,6) NOT NULL,
  PRIMARY KEY (currency, date)
);

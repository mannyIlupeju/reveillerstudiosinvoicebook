-- Reveiller Books schema. Money in cents; calendar dates as 'YYYY-MM-DD' text.
CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('OWNER','EDITOR','VIEWER')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE invites (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  role          text NOT NULL CHECK (role IN ('EDITOR','VIEWER')),
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_by_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE production_runs (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  line                  text NOT NULL DEFAULT 'RVS',
  status                text NOT NULL DEFAULT 'Planning',
  units                 integer NOT NULL CHECK (units > 0),
  date                  text NOT NULL,
  retail_price_cents    integer,
  wholesale_price_cents integer,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id            text PRIMARY KEY,
  type          text NOT NULL CHECK (type IN ('EXPENSE','INCOME')),
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  date          text NOT NULL,
  party         text NOT NULL DEFAULT '',
  category      text NOT NULL,
  description   text NOT NULL DEFAULT '',
  line          text NOT NULL DEFAULT 'Shared',
  run_id        text REFERENCES production_runs(id) ON DELETE SET NULL,
  source        text NOT NULL DEFAULT 'APP',
  recurring_key text UNIQUE,
  invoice_id    text UNIQUE,
  import_hash   text UNIQUE,
  created_by_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_date_idx ON transactions(date);
CREATE INDEX transactions_run_idx ON transactions(run_id);

CREATE TABLE receipts (
  id             text PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  filename       text NOT NULL,
  mime_type      text NOT NULL,
  size           integer NOT NULL,
  data           bytea NOT NULL,
  uploaded_by_id text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipts_txn_idx ON receipts(transaction_id);

CREATE TABLE budgets (
  category    text PRIMARY KEY,
  limit_cents bigint NOT NULL CHECK (limit_cents > 0)
);

CREATE TABLE recurring_rules (
  id           text PRIMARY KEY,
  party        text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  frequency    text NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  next_due     text NOT NULL,
  day_of_month integer NOT NULL,
  category     text NOT NULL,
  line         text NOT NULL DEFAULT 'Shared',
  description  text NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id                     text PRIMARY KEY,
  kind                   text NOT NULL CHECK (kind IN ('RECEIVABLE','PAYABLE')),
  number                 text NOT NULL DEFAULT '',
  party                  text NOT NULL,
  client_email           text NOT NULL DEFAULT '',
  items                  jsonb NOT NULL DEFAULT '[]',
  amount_cents           bigint NOT NULL CHECK (amount_cents > 0),
  category               text NOT NULL,
  line                   text NOT NULL DEFAULT 'Shared',
  issue_date             text NOT NULL,
  due_date               text NOT NULL,
  status                 text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAID','VOID')),
  paid_date              text,
  notes                  text NOT NULL DEFAULT '',
  public_token           text UNIQUE,
  shopify_draft_order_id text UNIQUE,
  shopify_invoice_url    text,
  shopify_order_id       text,
  sent_at                timestamptz,
  created_by_id          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_status_idx ON invoices(status);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE audit_log (
  id        text PRIMARY KEY,
  user_id   text,
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text,
  summary   text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);

-- Costs recorded against a production run without being entries in the books,
-- e.g. runs from before Reveiller Books whose spending is already accounted for elsewhere.
CREATE TABLE run_history_costs (
  id           text PRIMARY KEY,
  run_id       text NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  date         text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  party        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  category     text NOT NULL DEFAULT 'Production & Manufacturing',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_history_costs_run_idx ON run_history_costs(run_id);

ALTER TABLE production_runs ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE production_runs ADD COLUMN source text NOT NULL DEFAULT 'APP';

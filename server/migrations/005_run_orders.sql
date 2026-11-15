-- The supplier's quote for a production run, and which expenses are its deposit and final payment.
ALTER TABLE production_runs ADD COLUMN quoted_amount_cents bigint;
ALTER TABLE production_runs ADD COLUMN quoted_currency text NOT NULL DEFAULT 'CAD';
ALTER TABLE production_runs ADD COLUMN quoted_cad_cents bigint;

ALTER TABLE transactions ADD COLUMN run_payment text CHECK (run_payment IN ('DEPOSIT', 'FINAL'));
-- One deposit and one final payment per run.
CREATE UNIQUE INDEX transactions_run_payment_idx ON transactions (run_id, run_payment) WHERE run_payment IS NOT NULL;

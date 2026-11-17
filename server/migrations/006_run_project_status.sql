-- Production runs move to project statuses: Open, In progress, On hold, Closed.
UPDATE production_runs SET status = CASE status
  WHEN 'Planning' THEN 'Open'
  WHEN 'In production' THEN 'In progress'
  WHEN 'Selling' THEN 'Closed'
  WHEN 'Sold out' THEN 'Closed'
  ELSE status END;
ALTER TABLE production_runs ALTER COLUMN status SET DEFAULT 'Open';

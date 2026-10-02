-- 0002: integrity + precision fixes found in the audit.
--
-- 1. fx_rates.rate was stored as integer micro-units (x1_000_000). For a
--    strong-to-weak pair such as NGN->USD (~0.00065) that keeps only ~3
--    significant digits (0.025-0.046% error). A rate is not money, so it is
--    now stored as a REAL. interest_rate on financial_objects keeps the x1e6
--    integer encoding (percentages do not suffer from this).
CREATE TABLE fx_rates_new (
  base  TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate  REAL NOT NULL,                -- units of `quote` per 1 `base`
  PRIMARY KEY (base, quote)
);
INSERT INTO fx_rates_new (base, quote, rate)
  SELECT base, quote, rate / 1000000.0 FROM fx_rates;
DROP TABLE fx_rates;
ALTER TABLE fx_rates_new RENAME TO fx_rates;

-- 2. v_object_balances ignored transaction status, so void transactions were
--    counted (the app-side selectors skip them). Keep the two in agreement.
DROP VIEW IF EXISTS v_object_balances;
CREATE VIEW v_object_balances AS
SELECT
  e.object_id   AS object_id,
  SUM(e.amount) AS balance_minor
FROM entries e
JOIN transactions t ON t.id = e.transaction_id
WHERE COALESCE(t.status, 'cleared') <> 'void'
GROUP BY e.object_id;

-- 3. entries.{object,category,allocation,goal}_id had no foreign keys, so a
--    typo or a stale id produced an entry that pointed at nothing (and a
--    balance for an object that does not exist). SQLite cannot add an FK to an
--    existing table without a rebuild, so enforce the same rule with triggers.
CREATE TRIGGER IF NOT EXISTS trg_entries_refs_insert
BEFORE INSERT ON entries
BEGIN
  SELECT RAISE(ABORT, 'entry references a nonexistent object')
    WHERE NOT EXISTS (SELECT 1 FROM financial_objects WHERE id = NEW.object_id);
  SELECT RAISE(ABORT, 'entry references a nonexistent category')
    WHERE NEW.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id);
  SELECT RAISE(ABORT, 'entry references a nonexistent allocation')
    WHERE NEW.allocation_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM allocations WHERE id = NEW.allocation_id);
  SELECT RAISE(ABORT, 'entry references a nonexistent goal')
    WHERE NEW.goal_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM goals WHERE id = NEW.goal_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_entries_refs_update
BEFORE UPDATE OF object_id, category_id, allocation_id, goal_id ON entries
BEGIN
  SELECT RAISE(ABORT, 'entry references a nonexistent object')
    WHERE NOT EXISTS (SELECT 1 FROM financial_objects WHERE id = NEW.object_id);
  SELECT RAISE(ABORT, 'entry references a nonexistent category')
    WHERE NEW.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id);
  SELECT RAISE(ABORT, 'entry references a nonexistent allocation')
    WHERE NEW.allocation_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM allocations WHERE id = NEW.allocation_id);
  SELECT RAISE(ABORT, 'entry references a nonexistent goal')
    WHERE NEW.goal_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM goals WHERE id = NEW.goal_id);
END;

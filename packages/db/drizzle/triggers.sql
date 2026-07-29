-- LedgerOne — hand-written views and constraints layered on top of the
-- drizzle-generated tables.
--
-- Kept separate from the numbered migrations so that operations expressed
-- more naturally in raw SQL (multi-column CHECKs, computed views) live
-- next to the schema they enforce, in version control, without requiring
-- drizzle-kit to understand them.
--
-- Applied AFTER all `*.sql` files in ./drizzle/ by both the Rust migration
-- list (see src-tauri/src/main.rs) and the Node runner (migrate.ts).

-- NOTE: The "every transaction has ≥1 entries" invariant is enforced
-- app-side by `insertTransactionWithEntries` (see apps/desktop/src/lib/db/
-- queries.ts). It is NOT enforced at the database layer. SQLite has no
-- deferred cross-table CHECK, and `pragma defer_foreign_keys` only
-- postpones reference validity checks (does the referenced row exist),
-- not a minimum-cardinality rule. A previous version of this file
-- installed a `trg_transactions_require_entry` trigger whose body was
-- `SELECT 1;` — that gave false confidence without enforcing anything,
-- so it has been removed.

-- Convenience view: transaction totals per object, in the object's native
-- currency, expressed in integer minor units (same scale as entries.amount).
-- Consumers convert to major units via fromMoneyMinor() at the boundary.
CREATE VIEW IF NOT EXISTS v_object_balances AS
SELECT
  e.object_id       AS object_id,
  SUM(e.amount)     AS balance_minor
FROM entries e
GROUP BY e.object_id;

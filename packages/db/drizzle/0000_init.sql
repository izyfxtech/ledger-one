-- LedgerOne — initial schema.
--
-- This file is executed byte-identically by:
--   * the desktop app (Rust `rusqlite`, embedded via include_str!)
--   * the Node dev/test runner (better-sqlite3 via packages/db/src/migrate.ts)
--
-- The frontend's own test suite doesn't run these SQL files at all — it
-- mocks the individual Tauri commands (`db_*`) directly (see
-- apps/desktop/src/test/queries.test.ts and permissions.test.ts), since
-- Rust owns all SQL execution and the frontend never talks to SQLite
-- itself.
--
-- It represents the shape emitted by `drizzle-kit generate` for the schema
-- in `packages/db/src/schema.ts`. Regenerate rather than hand-edit.

CREATE TABLE IF NOT EXISTS domains (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_objects (
  id            TEXT PRIMARY KEY,
  domain_id     TEXT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  institution   TEXT,
  kind          TEXT NOT NULL,
  currency      TEXT NOT NULL,
  -- All monetary/rate columns are INTEGER minor units. See
  -- packages/db/src/money.ts for the scaling helpers used at the boundary.
  interest_rate INTEGER,   -- rate ×1_000_000
  min_payment   INTEGER,   -- money ×100
  credit_limit  INTEGER,   -- money ×100
  due_day       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_objects_domain ON financial_objects(domain_id);

CREATE TABLE IF NOT EXISTS categories (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  -- Self-referencing FK. ON DELETE RESTRICT keeps deletes loud when a
  -- parent still has children; cycle prevention is enforced app-side
  -- (SQLite has no way to express it declaratively).
  parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  type      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allocations (
  id              TEXT PRIMARY KEY,
  domain_id       TEXT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  target          INTEGER,           -- money ×100
  target_currency TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id                    TEXT PRIMARY KEY,
  domain_id             TEXT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  name                  TEXT NOT NULL,
  target                INTEGER NOT NULL,   -- money ×100
  currency              TEXT NOT NULL,
  deadline              TEXT NOT NULL,
  priority              TEXT,
  linked_allocation_id  TEXT,
  notes                 TEXT
);

CREATE TABLE IF NOT EXISTS budgets (
  id        TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  month     TEXT NOT NULL,
  currency  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_lines (
  budget_id   TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  amount      INTEGER NOT NULL,       -- money ×100
  PRIMARY KEY (budget_id, category_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL,
  kind        TEXT NOT NULL,
  -- Fixed vocabulary; NULL means "unspecified" (treated as 'cleared' by
  -- balance selectors). 'void' is the only value excluded from balances.
  status      TEXT CHECK (
    status IS NULL OR status IN ('pending', 'cleared', 'reconciled', 'void')
  ),
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at);

CREATE TABLE IF NOT EXISTS entries (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  object_id      TEXT NOT NULL,
  amount         INTEGER NOT NULL,    -- money ×100
  category_id    TEXT,
  allocation_id  TEXT,
  goal_id        TEXT,
  position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entries_transaction ON entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_entries_object      ON entries(object_id);

CREATE TABLE IF NOT EXISTS fx_rates (
  base  TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate  INTEGER NOT NULL,             -- rate ×1_000_000
  PRIMARY KEY (base, quote)
);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

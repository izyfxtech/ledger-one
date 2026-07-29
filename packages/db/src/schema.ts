// Drizzle schema for LedgerOne. This file is the single source of truth for
// the database structure; `pnpm --filter @ledgerone/db generate` emits the
// SQL under ./drizzle/*.sql, which is then consumed byte-identically by:
//
//   * the shipped desktop app (Rust `rusqlite`, embedded via include_str!)
//   * the Node-side test double (better-sqlite3 through mockTauriSql)
//   * the dev migration runner (`pnpm --filter @ledgerone/db run migrate:dev`)
//
// Design notes:
//   * `id` columns are TEXT to preserve the app-level prefixed IDs
//     (`tx_`, `obj_`, `dom_`, ...) that the frontend already generates.
//   * Monetary values are INTEGER minor units (cents/kobo, i.e. major ×100)
//     and rates are INTEGER scaled by 1e6. Conversion to/from plain
//     "major-unit" JS numbers happens ONLY at the DB boundary in
//     `apps/desktop/src/lib/db/queries.ts`, via the helpers exported from
//     `./money.ts`. Never let a raw column value leak into UI code.
//   * Foreign keys use ON DELETE CASCADE where the child row has no
//     meaning without its parent (entries -> transaction, budget_lines
//     -> budget), and ON DELETE RESTRICT elsewhere so orphaning is loud.
//   * `categories.parent_id` is a self-referencing FK with ON DELETE
//     RESTRICT so a parent cannot be deleted while children exist. Cycle
//     prevention is enforced at the app layer (SQLite cannot express it).
//   * `transactions.status` is constrained to a fixed vocabulary via a
//     CHECK constraint in 0000_init.sql: NULL | 'pending' | 'cleared' |
//     'reconciled' | 'void'. Only 'void' entries are excluded from
//     balance selectors; the rest all contribute.
//   * `settings` is a KV table so we can evolve workspace preferences
//     without schema churn. `settings.workspace_initialized` is the
//     first-run seed gate.
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'personal' | 'business' | 'trading'
  displayCurrency: text("display_currency"),
  description: text("description"),
});

export const financialObjects = sqliteTable(
  "financial_objects",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    institution: text("institution"),
    kind: text("kind").notNull(),
    currency: text("currency").notNull(),
    interestRate: integer("interest_rate"), // rate ×1e6 (see money.ts)
    minPayment: integer("min_payment"), // money minor units
    creditLimit: integer("credit_limit"), // money minor units
    dueDay: integer("due_day"),
  },
  (t) => ({
    byDomain: index("idx_objects_domain").on(t.domainId),
  }),
);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  parentId: text("parent_id").references((): AnySQLiteColumn => categories.id, {
    onDelete: "restrict",
  }),
  type: text("type").notNull(), // 'income' | 'expense'
});

export const allocations = sqliteTable("allocations", {
  id: text("id").primaryKey(),
  domainId: text("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  target: integer("target"), // money minor units
  targetCurrency: text("target_currency").notNull(),
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  domainId: text("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  target: integer("target").notNull(), // money minor units
  currency: text("currency").notNull(),
  deadline: text("deadline").notNull(),
  priority: text("priority"),
  linkedAllocationId: text("linked_allocation_id"),
  notes: text("notes"),
});

export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(),
  domainId: text("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "restrict" }),
  month: text("month").notNull(), // YYYY-MM
  currency: text("currency").notNull(),
});

export const budgetLines = sqliteTable(
  "budget_lines",
  {
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull(),
    amount: integer("amount").notNull(), // money minor units
  },
  (t) => ({
    pk: primaryKey({ columns: [t.budgetId, t.categoryId] }),
  }),
);

/** Vocabulary for `transactions.status`. NULL means "unspecified" and is
 *  treated as `'cleared'` by balance selectors. `'void'` is the ONLY value
 *  excluded from balance computations. */
export type TransactionStatus =
  | "pending"
  | "cleared"
  | "reconciled"
  | "void";

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    occurredAt: text("occurred_at").notNull(), // ISO date
    description: text("description").notNull(),
    kind: text("kind").notNull(),
    status: text("status").$type<TransactionStatus>(), // CHECK in 0000_init.sql
    notes: text("notes"),
  },
  (t) => ({
    byDate: index("idx_transactions_occurred_at").on(t.occurredAt),
  }),
);

export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    objectId: text("object_id").notNull(),
    amount: integer("amount").notNull(), // money minor units
    categoryId: text("category_id"),
    allocationId: text("allocation_id"),
    goalId: text("goal_id"),
    position: integer("position").notNull().default(0),
  },
  (t) => ({
    byTx: index("idx_entries_transaction").on(t.transactionId),
    byObject: index("idx_entries_object").on(t.objectId),
  }),
);

export const fxRates = sqliteTable(
  "fx_rates",
  {
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: integer("rate").notNull(), // rate ×1e6 (see money.ts)
  },
  (t) => ({
    pk: primaryKey({ columns: [t.base, t.quote] }),
  }),
);

export const currencies = sqliteTable("currencies", {
  code: text("code").primaryKey(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

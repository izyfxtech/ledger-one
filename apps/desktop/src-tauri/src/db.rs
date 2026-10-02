// Rust-owned SQLite persistence layer.
//
// Previously the frontend sent raw SQL strings to `tauri-plugin-sql` over
// IPC — Rust was just a relay, not a real backend. This module ports that
// same, already-tested SQL (see the git history of
// apps/desktop/src/lib/db/queries.ts, and its Vitest suite) to run
// natively here instead. The schema, table names, column names, and
// query logic are unchanged; only the execution boundary moved.
//
// IMPORTANT: I (the model that wrote this) could not compile or run this
// code — no working Rust toolchain was available in the environment this
// was written in. The SQL statements themselves are copied from
// already-tested TypeScript, so the *logic* has real test coverage; what's
// unverified is that this Rust compiles and that the rusqlite API is used
// correctly. Run `cargo build` and `cargo test` before trusting this.

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction as SqlTransaction};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use serde::Deserializer;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Connection>);

/// Distinguishes "key absent" (None: leave the column alone) from "key present
/// and null" (Some(None): clear it) from "key present with a value"
/// (Some(Some(v))). Plain `Option<T>` collapses the last two-of-three and made
/// it impossible to clear an optional field through a patch.
fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

// ---------------------------------------------------------------------------
// Money / rate unit conversion — mirrors packages/db/src/money.ts exactly.
// Amounts are stored as integer minor units (×100); rates as integer
// micro-units (×1_000_000) — used only for interest_rate; FX rates are plain
// REALs since migration 0002. Both round-half-away-from-zero (f64::round), and
// packages/db/src/money.ts now rounds the same way for negative halves.
// ---------------------------------------------------------------------------

fn to_money_minor(v: Option<f64>) -> Option<i64> {
    v.map(|n| (n * 100.0).round() as i64)
}
fn from_money_minor(v: Option<i64>) -> Option<f64> {
    v.map(|n| (n as f64) / 100.0)
}
fn to_rate_minor(v: Option<f64>) -> Option<i64> {
    v.map(|n| (n * 1_000_000.0).round() as i64)
}
fn from_rate_minor(v: Option<i64>) -> Option<f64> {
    v.map(|n| (n as f64) / 1_000_000.0)
}

// ---------------------------------------------------------------------------
// Types — mirror apps/desktop/src/lib/ledger/types.ts field-for-field.
// camelCase on the wire (JS side); snake_case in Rust.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Partial update for a domain. `name`/`kind` use plain-Option "omit to
/// skip" semantics (matching every other patch type here). `display_currency`
/// and `description` are different: the one real caller (Domain Settings'
/// save button, see domain-workspace.tsx) always sends both, using an
/// explicit `null` to mean "clear back to inherited/empty" as distinct from
/// the key being absent. `#[serde(flatten)] extra` captures the raw JSON so
/// we can tell "key absent" (not in the map) from "key present as null"
/// (`Value::Null`) — a plain `Option<Option<T>>` can't make that
/// distinction without a custom deserializer, and this is more obviously
/// correct without one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, Json>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialObject {
    pub id: String,
    pub domain_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub institution: Option<String>,
    pub kind: String,
    pub currency: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interest_rate: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_payment: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_limit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_day: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPatch {
    #[serde(default)]
    pub domain_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub institution: Option<Option<String>>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub interest_rate: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub min_payment: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub credit_limit: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_day: Option<Option<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String, // "income" | "expense" — `type` is a Rust keyword
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    pub id: String,
    pub domain_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<f64>,
    pub target_currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub domain_id: String,
    pub name: String,
    pub target: f64,
    pub currency: String,
    pub deadline: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_allocation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetLine {
    pub category_id: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub id: String,
    pub domain_id: String,
    pub month: String,
    pub currency: String,
    pub lines: Vec<BudgetLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub object_id: String,
    pub amount: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allocation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub date: String,
    pub description: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPatch {
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    #[serde(default)]
    pub entries: Option<Vec<Entry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxRate {
    pub base: String,
    pub quote: String,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    pub workspace_name: String,
    pub default_currency: String,
    pub fiscal_year_start: String,
    pub timezone: String,
    pub theme: String,
    pub density: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerState {
    pub currencies: Vec<String>,
    pub fx: Vec<FxRate>,
    pub domains: Vec<Domain>,
    pub objects: Vec<FinancialObject>,
    pub categories: Vec<Category>,
    pub allocations: Vec<Allocation>,
    pub goals: Vec<Goal>,
    pub budgets: Vec<Budget>,
    pub transactions: Vec<Transaction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<WorkspaceSettings>,
}

// ---------------------------------------------------------------------------
// Connection + migrations
// ---------------------------------------------------------------------------

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "0000_init",
        include_str!("../../../../packages/db/drizzle/0000_init.sql"),
    ),
    (
        "0001_domain_fields",
        include_str!("../../../../packages/db/drizzle/0001_domain_fields.sql"),
    ),
    (
        "triggers",
        include_str!("../../../../packages/db/drizzle/triggers.sql"),
    ),
    (
        "0002_integrity_and_fx_precision",
        include_str!("../../../../packages/db/drizzle/0002_integrity_and_fx_precision.sql"),
    ),
];

/// Opens (creating if needed) the SQLite database in the OS-standard
/// per-app data directory, enables FK enforcement (SQLite disables this
/// per-connection by default — see the long comment history in the old
/// client.ts this replaces), and runs any migrations that haven't been
/// applied yet, tracked in a `_schema_migrations` bookkeeping table.
pub fn open_and_migrate(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_data_dir()
        .expect("resolve app data dir");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("ledger.db");

    let mut conn = Connection::open(path)?;
    run_migrations(&mut conn)?;
    Ok(conn)
}

/// Enables FK enforcement (SQLite disables this per-connection by default)
/// and applies any migrations not yet recorded in `_schema_migrations`.
/// Split out from open_and_migrate() so tests can run it against an
/// in-memory connection without a real AppHandle.
fn run_migrations(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
    )?;

    for (name, sql) in MIGRATIONS {
        let already: Option<String> = conn
            .query_row(
                "SELECT name FROM _schema_migrations WHERE name = ?1",
                params![name],
                |r| r.get(0),
            )
            .optional()?;
        if already.is_some() {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO _schema_migrations(name, applied_at) VALUES (?1, ?2)",
            params![name, chrono_now()],
        )?;
        tx.commit()?;
    }
    Ok(())
}

/// Minimal ISO-8601-ish timestamp without pulling in the `chrono` crate for
/// one column that's only ever used for human debugging, never compared.
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

// ---------------------------------------------------------------------------
// Settings KV
// ---------------------------------------------------------------------------

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<Json>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set_setting(conn: &Connection, key: &str, value: &Json) -> rusqlite::Result<()> {
    let json = serde_json::to_string(value).unwrap_or_else(|_| "null".to_string());
    conn.execute(
        "INSERT INTO settings(key, value_json) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        params![key, json],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Read: select_ledger_state — mirrors queries.ts's selectLedgerState()
// exactly: one SELECT per table, grouped in memory (no JOINs), same sort
// orders.
// ---------------------------------------------------------------------------

fn domain_from_row(row: &Row) -> rusqlite::Result<Domain> {
    Ok(Domain {
        id: row.get("id")?,
        name: row.get("name")?,
        kind: row.get("kind")?,
        display_currency: row.get("display_currency")?,
        description: row.get("description")?,
    })
}

fn object_from_row(row: &Row) -> rusqlite::Result<FinancialObject> {
    Ok(FinancialObject {
        id: row.get("id")?,
        domain_id: row.get("domain_id")?,
        name: row.get("name")?,
        institution: row.get("institution")?,
        kind: row.get("kind")?,
        currency: row.get("currency")?,
        interest_rate: from_rate_minor(row.get("interest_rate")?),
        min_payment: from_money_minor(row.get("min_payment")?),
        credit_limit: from_money_minor(row.get("credit_limit")?),
        due_day: row.get("due_day")?,
    })
}

fn category_from_row(row: &Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get("id")?,
        name: row.get("name")?,
        parent_id: row.get("parent_id")?,
        kind: row.get("type")?,
    })
}

fn allocation_from_row(row: &Row) -> rusqlite::Result<Allocation> {
    Ok(Allocation {
        id: row.get("id")?,
        domain_id: row.get("domain_id")?,
        name: row.get("name")?,
        target: from_money_minor(row.get("target")?),
        target_currency: row.get("target_currency")?,
    })
}

fn goal_from_row(row: &Row) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: row.get("id")?,
        domain_id: row.get("domain_id")?,
        name: row.get("name")?,
        target: from_money_minor(row.get("target")?).unwrap_or(0.0),
        currency: row.get("currency")?,
        deadline: row.get("deadline")?,
        priority: row.get("priority")?,
        linked_allocation_id: row.get("linked_allocation_id")?,
        notes: row.get("notes")?,
    })
}

fn entry_from_row(row: &Row) -> rusqlite::Result<(String, Entry)> {
    let transaction_id: String = row.get("transaction_id")?;
    let entry = Entry {
        object_id: row.get("object_id")?,
        amount: from_money_minor(row.get("amount")?).unwrap_or(0.0),
        category_id: row.get("category_id")?,
        allocation_id: row.get("allocation_id")?,
        goal_id: row.get("goal_id")?,
    };
    Ok((transaction_id, entry))
}

pub fn select_ledger_state(conn: &Connection) -> rusqlite::Result<LedgerState> {
    let domains = {
        let mut stmt = conn.prepare("SELECT * FROM domains ORDER BY name")?;
        let rows = stmt.query_map([], domain_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let objects = {
        let mut stmt = conn.prepare("SELECT * FROM financial_objects ORDER BY name")?;
        let rows = stmt.query_map([], object_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let categories = {
        let mut stmt = conn.prepare("SELECT * FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], category_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let allocations = {
        let mut stmt = conn.prepare("SELECT * FROM allocations ORDER BY name")?;
        let rows = stmt.query_map([], allocation_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let goals = {
        let mut stmt = conn.prepare("SELECT * FROM goals ORDER BY deadline")?;
        let rows = stmt.query_map([], goal_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    // budgets + budget_lines, grouped by budget_id
    let mut lines_by_budget: HashMap<String, Vec<BudgetLine>> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT budget_id, category_id, amount FROM budget_lines")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let budget_id: String = row.get("budget_id")?;
            let amount: i64 = row.get("amount")?;
            lines_by_budget.entry(budget_id).or_default().push(BudgetLine {
                category_id: row.get("category_id")?,
                amount: from_money_minor(Some(amount)).unwrap_or(0.0),
            });
        }
    }
    let budgets = {
        let mut stmt = conn.prepare("SELECT * FROM budgets ORDER BY month DESC")?;
        let mut rows = stmt.query([])?;
        let mut out = vec![];
        while let Some(row) = rows.next()? {
            let id: String = row.get("id")?;
            out.push(Budget {
                lines: lines_by_budget.get(&id).cloned().unwrap_or_default(),
                id,
                domain_id: row.get("domain_id")?,
                month: row.get("month")?,
                currency: row.get("currency")?,
            });
        }
        out
    };

    // transactions + entries, grouped by transaction_id
    let mut entries_by_tx: HashMap<String, Vec<Entry>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT * FROM entries ORDER BY transaction_id, position",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let (tx_id, entry) = entry_from_row(row)?;
            entries_by_tx.entry(tx_id).or_default().push(entry);
        }
    }
    let transactions = {
        let mut stmt = conn.prepare(
            "SELECT * FROM transactions ORDER BY occurred_at DESC, id DESC",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = vec![];
        while let Some(row) = rows.next()? {
            let id: String = row.get("id")?;
            out.push(Transaction {
                entries: entries_by_tx.get(&id).cloned().unwrap_or_default(),
                id,
                date: row.get("occurred_at")?,
                description: row.get("description")?,
                kind: row.get("kind")?,
                status: row.get("status")?,
                notes: row.get("notes")?,
            });
        }
        out
    };

    let fx = {
        let mut stmt = conn.prepare("SELECT base, quote, rate FROM fx_rates")?;
        let mut rows = stmt.query([])?;
        let mut out = vec![];
        while let Some(row) = rows.next()? {
            let rate: f64 = row.get("rate")?;
            out.push(FxRate {
                base: row.get("base")?,
                quote: row.get("quote")?,
                rate,
            });
        }
        out
    };

    let currencies = {
        let mut stmt = conn.prepare("SELECT code FROM currencies ORDER BY code")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>("code"))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    let settings: Option<WorkspaceSettings> =
        get_setting(conn, "workspace_settings")?.and_then(|v| serde_json::from_value(v).ok());

    Ok(LedgerState {
        currencies,
        fx,
        domains,
        objects,
        categories,
        allocations,
        goals,
        budgets,
        transactions,
        settings,
    })
}

// ---------------------------------------------------------------------------
// Write: domains
// ---------------------------------------------------------------------------

pub fn insert_domain(conn: &Connection, d: &Domain) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO domains(id, name, kind, display_currency, description) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![d.id, d.name, d.kind, d.display_currency, d.description],
    )?;
    Ok(())
}

pub fn update_domain(conn: &Connection, id: &str, patch: &DomainPatch) -> rusqlite::Result<()> {
    let mut sets: Vec<String> = vec![];
    let mut owned: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(name) = &patch.name {
        owned.push(Box::new(name.clone()));
        sets.push(format!("name = ?{}", owned.len()));
    }
    if let Some(kind) = &patch.kind {
        owned.push(Box::new(kind.clone()));
        sets.push(format!("kind = ?{}", owned.len()));
    }
    // See DomainPatch's doc comment: `extra` lets us tell "key absent" from
    // "key present as null" — the latter means "clear this field".
    if let Some(v) = patch.extra.get("displayCurrency") {
        let val: Option<String> = if v.is_null() { None } else { v.as_str().map(String::from) };
        owned.push(Box::new(val));
        sets.push(format!("display_currency = ?{}", owned.len()));
    }
    if let Some(v) = patch.extra.get("description") {
        let val: Option<String> = if v.is_null() { None } else { v.as_str().map(String::from) };
        owned.push(Box::new(val));
        sets.push(format!("description = ?{}", owned.len()));
    }

    if sets.is_empty() {
        return Ok(());
    }
    owned.push(Box::new(id.to_string()));
    let sql = format!(
        "UPDATE domains SET {} WHERE id = ?{}",
        sets.join(", "),
        owned.len()
    );
    let refs: Vec<&dyn rusqlite::ToSql> = owned.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, refs.as_slice())?;
    Ok(())
}

/// Cascade the domain's dependent rows manually (same approach as the TS
/// version this replaces, for the same reasons: RESTRICT FKs on domain_id,
/// and not wanting to depend on every code path remembering `PRAGMA
/// foreign_keys = ON` for entries/budget_lines' CASCADE either).
pub fn delete_domain(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;

    let object_ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM financial_objects WHERE domain_id = ?1")?;
        let rows = stmt
            .query_map(params![id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    detach_objects(&tx, &object_ids)?;

    // Entries on surviving objects (e.g. another domain's account) may still
    // carry this domain's allocation/goal tags; clear them rather than leave a
    // tag that points at nothing.
    tx.execute(
        "UPDATE entries SET allocation_id = NULL
          WHERE allocation_id IN (SELECT id FROM allocations WHERE domain_id = ?1)",
        params![id],
    )?;
    tx.execute(
        "UPDATE entries SET goal_id = NULL
          WHERE goal_id IN (SELECT id FROM goals WHERE domain_id = ?1)",
        params![id],
    )?;
    tx.execute(
        "UPDATE goals SET linked_allocation_id = NULL
          WHERE linked_allocation_id IN (SELECT id FROM allocations WHERE domain_id = ?1)",
        params![id],
    )?;

    tx.execute("DELETE FROM financial_objects WHERE domain_id = ?1", params![id])?;
    tx.execute("DELETE FROM allocations WHERE domain_id = ?1", params![id])?;
    tx.execute("DELETE FROM goals WHERE domain_id = ?1", params![id])?;
    tx.execute(
        "DELETE FROM budget_lines WHERE budget_id IN (SELECT id FROM budgets WHERE domain_id = ?1)",
        params![id],
    )?;
    tx.execute("DELETE FROM budgets WHERE domain_id = ?1", params![id])?;
    tx.execute("DELETE FROM domains WHERE id = ?1", params![id])?;

    tx.commit()
}

pub fn insert_object(conn: &Connection, o: &FinancialObject) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO financial_objects
           (id, domain_id, name, institution, kind, currency,
            interest_rate, min_payment, credit_limit, due_day)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            o.id,
            o.domain_id,
            o.name,
            o.institution,
            o.kind,
            o.currency,
            to_rate_minor(o.interest_rate),
            to_money_minor(o.min_payment),
            to_money_minor(o.credit_limit),
            o.due_day,
        ],
    )?;
    Ok(())
}

pub fn update_object(conn: &Connection, id: &str, patch: &ObjectPatch) -> rusqlite::Result<()> {
    let mut sets: Vec<String> = vec![];
    let mut owned: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    macro_rules! push {
        ($col:literal, $val:expr) => {{
            owned.push(Box::new($val));
            sets.push(format!("{} = ?{}", $col, owned.len()));
        }};
    }
    if let Some(v) = &patch.domain_id { push!("domain_id", v.clone()); }
    if let Some(v) = &patch.name { push!("name", v.clone()); }
    if let Some(v) = &patch.institution { push!("institution", v.clone()); }
    if let Some(v) = &patch.kind { push!("kind", v.clone()); }
    if let Some(v) = &patch.currency { push!("currency", v.clone()); }
    if let Some(v) = patch.interest_rate { push!("interest_rate", to_rate_minor(v)); }
    if let Some(v) = patch.min_payment { push!("min_payment", to_money_minor(v)); }
    if let Some(v) = patch.credit_limit { push!("credit_limit", to_money_minor(v)); }
    if let Some(v) = patch.due_day { push!("due_day", v); }

    if sets.is_empty() {
        return Ok(());
    }
    owned.push(Box::new(id.to_string()));
    let sql = format!(
        "UPDATE financial_objects SET {} WHERE id = ?{}",
        sets.join(", "),
        owned.len()
    );
    let refs: Vec<&dyn rusqlite::ToSql> = owned.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, refs.as_slice())?;
    Ok(())
}

/// Remove `object_ids` from the ledger without corrupting what is left.
///
/// * A transaction whose entries ALL sit on the doomed objects is deleted.
/// * A transaction that also has entries on surviving objects (a transfer to
///   another account or domain) keeps those entries, but is marked `void` with
///   a note. Dropping just one leg would leave a one-sided entry that still
///   counted toward the surviving account's balance; void keeps the history
///   and takes it out of every balance, exactly like a user-voided entry.
/// * Transactions that never touched the doomed objects (including any that
///   legitimately have no entries) are left alone. The previous
///   `NOT EXISTS (... <> id)` form also matched those and deleted them.
fn detach_objects(tx: &SqlTransaction, object_ids: &[String]) -> rusqlite::Result<()> {
    if object_ids.is_empty() {
        return Ok(());
    }
    let ids = serde_json::to_string(object_ids).unwrap();

    let wholly_owned: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT DISTINCT transaction_id FROM entries
               WHERE object_id IN (SELECT value FROM json_each(?1))
             EXCEPT
             SELECT DISTINCT transaction_id FROM entries
               WHERE object_id NOT IN (SELECT value FROM json_each(?1))",
        )?;
        let rows = stmt
            .query_map(params![ids], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    if !wholly_owned.is_empty() {
        let owned_json = serde_json::to_string(&wholly_owned).unwrap();
        tx.execute(
            "DELETE FROM entries WHERE transaction_id IN (SELECT value FROM json_each(?1))",
            params![owned_json],
        )?;
        tx.execute(
            "DELETE FROM transactions WHERE id IN (SELECT value FROM json_each(?1))",
            params![owned_json],
        )?;
    }

    // What still has an entry on a doomed object is, by construction, a
    // transaction with survivors.
    tx.execute(
        "UPDATE transactions
            SET status = 'void',
                notes  = CASE WHEN notes IS NULL OR notes = ''
                              THEN 'Voided: counterpart account was deleted'
                              ELSE notes || ' | Voided: counterpart account was deleted' END
          WHERE id IN (SELECT DISTINCT transaction_id FROM entries
                        WHERE object_id IN (SELECT value FROM json_each(?1)))",
        params![ids],
    )?;
    tx.execute(
        "DELETE FROM entries WHERE object_id IN (SELECT value FROM json_each(?1))",
        params![ids],
    )?;
    Ok(())
}

pub fn delete_object(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    detach_objects(&tx, &[id.to_string()])?;
    tx.execute("DELETE FROM financial_objects WHERE id = ?1", params![id])?;
    tx.commit()
}

// ---------------------------------------------------------------------------
// Write: allocations, goals, budgets, categories
// ---------------------------------------------------------------------------

pub fn insert_allocation(conn: &Connection, a: &Allocation) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO allocations(id, domain_id, name, target, target_currency) VALUES (?1,?2,?3,?4,?5)",
        params![a.id, a.domain_id, a.name, to_money_minor(a.target), a.target_currency],
    )?;
    Ok(())
}

pub fn insert_goal(conn: &Connection, g: &Goal) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO goals(id, domain_id, name, target, currency, deadline,
                           priority, linked_allocation_id, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            g.id,
            g.domain_id,
            g.name,
            to_money_minor(Some(g.target)),
            g.currency,
            g.deadline,
            g.priority,
            g.linked_allocation_id,
            g.notes,
        ],
    )?;
    Ok(())
}

pub fn insert_budget(conn: &mut Connection, b: &Budget) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO budgets(id, domain_id, month, currency) VALUES (?1,?2,?3,?4)",
        params![b.id, b.domain_id, b.month, b.currency],
    )?;
    for line in &b.lines {
        tx.execute(
            "INSERT INTO budget_lines(budget_id, category_id, amount) VALUES (?1,?2,?3)",
            params![b.id, line.category_id, to_money_minor(Some(line.amount))],
        )?;
    }
    tx.commit()
}

pub fn insert_category(conn: &Connection, c: &Category) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO categories(id, name, parent_id, type) VALUES (?1,?2,?3,?4)",
        params![c.id, c.name, c.parent_id, c.kind],
    )?;
    Ok(())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalPatch {
    #[serde(default)] pub name: Option<String>,
    #[serde(default)] pub target: Option<f64>,
    #[serde(default)] pub currency: Option<String>,
    #[serde(default)] pub deadline: Option<String>,
    #[serde(default, deserialize_with = "double_option")] pub priority: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")] pub linked_allocation_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")] pub notes: Option<Option<String>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllocationPatch {
    #[serde(default)] pub name: Option<String>,
    #[serde(default, deserialize_with = "double_option")] pub target: Option<Option<f64>>,
    #[serde(default)] pub target_currency: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPatch {
    #[serde(default)] pub name: Option<String>,
    #[serde(default, deserialize_with = "double_option")] pub parent_id: Option<Option<String>>,
}

/// Shared "build an UPDATE from whichever fields are present" helper.
fn run_update(
    conn: &Connection,
    table: &str,
    id: &str,
    sets: Vec<String>,
    mut owned: Vec<Box<dyn rusqlite::ToSql>>,
) -> rusqlite::Result<()> {
    if sets.is_empty() {
        return Ok(());
    }
    owned.push(Box::new(id.to_string()));
    let sql = format!("UPDATE {table} SET {} WHERE id = ?{}", sets.join(", "), owned.len());
    let refs: Vec<&dyn rusqlite::ToSql> = owned.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, refs.as_slice())?;
    Ok(())
}

pub fn update_goal(conn: &Connection, id: &str, p: &GoalPatch) -> rusqlite::Result<()> {
    let mut sets = vec![];
    let mut owned: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    macro_rules! push { ($col:literal, $v:expr) => {{ owned.push(Box::new($v)); sets.push(format!("{} = ?{}", $col, owned.len())); }}; }
    if let Some(v) = &p.name { push!("name", v.clone()); }
    if let Some(v) = p.target { push!("target", to_money_minor(Some(v))); }
    if let Some(v) = &p.currency { push!("currency", v.clone()); }
    if let Some(v) = &p.deadline { push!("deadline", v.clone()); }
    if let Some(v) = &p.priority { push!("priority", v.clone()); }
    if let Some(v) = &p.linked_allocation_id { push!("linked_allocation_id", v.clone()); }
    if let Some(v) = &p.notes { push!("notes", v.clone()); }
    run_update(conn, "goals", id, sets, owned)
}

pub fn delete_goal(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE entries SET goal_id = NULL WHERE goal_id = ?1", params![id])?;
    tx.execute("DELETE FROM goals WHERE id = ?1", params![id])?;
    tx.commit()
}

pub fn update_allocation(conn: &Connection, id: &str, p: &AllocationPatch) -> rusqlite::Result<()> {
    let mut sets = vec![];
    let mut owned: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    macro_rules! push { ($col:literal, $v:expr) => {{ owned.push(Box::new($v)); sets.push(format!("{} = ?{}", $col, owned.len())); }}; }
    if let Some(v) = &p.name { push!("name", v.clone()); }
    if let Some(v) = p.target { push!("target", to_money_minor(v)); }
    if let Some(v) = &p.target_currency { push!("target_currency", v.clone()); }
    run_update(conn, "allocations", id, sets, owned)
}

pub fn delete_allocation(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE entries SET allocation_id = NULL WHERE allocation_id = ?1", params![id])?;
    tx.execute("UPDATE goals SET linked_allocation_id = NULL WHERE linked_allocation_id = ?1", params![id])?;
    tx.execute("DELETE FROM allocations WHERE id = ?1", params![id])?;
    tx.commit()
}

/// Replace a budget's currency and lines wholesale (month and domain are
/// identity and stay fixed).
pub fn update_budget(conn: &mut Connection, b: &Budget) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE budgets SET currency = ?1 WHERE id = ?2", params![b.currency, b.id])?;
    tx.execute("DELETE FROM budget_lines WHERE budget_id = ?1", params![b.id])?;
    for line in &b.lines {
        tx.execute(
            "INSERT INTO budget_lines(budget_id, category_id, amount) VALUES (?1,?2,?3)",
            params![b.id, line.category_id, to_money_minor(Some(line.amount))],
        )?;
    }
    tx.commit()
}

pub fn delete_budget(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM budget_lines WHERE budget_id = ?1", params![id])?;
    tx.execute("DELETE FROM budgets WHERE id = ?1", params![id])?;
    tx.commit()
}

pub fn update_category(conn: &Connection, id: &str, p: &CategoryPatch) -> rusqlite::Result<()> {
    let mut sets = vec![];
    let mut owned: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    macro_rules! push { ($col:literal, $v:expr) => {{ owned.push(Box::new($v)); sets.push(format!("{} = ?{}", $col, owned.len())); }}; }
    if let Some(v) = &p.name { push!("name", v.clone()); }
    if let Some(v) = &p.parent_id { push!("parent_id", v.clone()); }
    run_update(conn, "categories", id, sets, owned)
}

/// Delete a category. With `reassign_to` this is a merge: entries and budget
/// lines move to the target (a line that would duplicate an existing one is
/// folded into it). Without it, tagged entries become uncategorised and the
/// category's budget lines are removed. Children are promoted to top level.
pub fn delete_category(conn: &mut Connection, id: &str, reassign_to: Option<&str>) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    match reassign_to {
        Some(target) if target != id => {
            tx.execute("UPDATE entries SET category_id = ?1 WHERE category_id = ?2", params![target, id])?;
            // fold lines: add into an existing target line, else re-point
            tx.execute(
                "UPDATE budget_lines SET amount = amount + (
                     SELECT l.amount FROM budget_lines l
                      WHERE l.budget_id = budget_lines.budget_id AND l.category_id = ?2)
                  WHERE category_id = ?1
                    AND EXISTS (SELECT 1 FROM budget_lines l
                                 WHERE l.budget_id = budget_lines.budget_id AND l.category_id = ?2)",
                params![target, id],
            )?;
            tx.execute(
                "DELETE FROM budget_lines WHERE category_id = ?2
                   AND EXISTS (SELECT 1 FROM budget_lines l
                                WHERE l.budget_id = budget_lines.budget_id AND l.category_id = ?1)",
                params![target, id],
            )?;
            tx.execute("UPDATE budget_lines SET category_id = ?1 WHERE category_id = ?2", params![target, id])?;
        }
        _ => {
            tx.execute("UPDATE entries SET category_id = NULL WHERE category_id = ?1", params![id])?;
            tx.execute("DELETE FROM budget_lines WHERE category_id = ?1", params![id])?;
        }
    }
    tx.execute("UPDATE categories SET parent_id = NULL WHERE parent_id = ?1", params![id])?;
    tx.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
    tx.commit()
}

// ---------------------------------------------------------------------------
// Write: transactions
// ---------------------------------------------------------------------------

fn insert_entries(tx: &SqlTransaction, transaction_id: &str, entries: &[Entry]) -> rusqlite::Result<()> {
    for (pos, e) in entries.iter().enumerate() {
        tx.execute(
            "INSERT INTO entries
               (id, transaction_id, object_id, amount,
                category_id, allocation_id, goal_id, position)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                format!("ent_{transaction_id}_{pos}"),
                transaction_id,
                e.object_id,
                to_money_minor(Some(e.amount)),
                e.category_id,
                e.allocation_id,
                e.goal_id,
                pos as i64,
            ],
        )?;
    }
    Ok(())
}

pub fn insert_transaction(conn: &mut Connection, t: &Transaction) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO transactions(id, occurred_at, description, kind, status, notes)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![t.id, t.date, t.description, t.kind, t.status, t.notes],
    )?;
    insert_entries(&tx, &t.id, &t.entries)?;
    tx.commit()
}

pub fn update_transaction(
    conn: &mut Connection,
    id: &str,
    patch: &TransactionPatch,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;

    let mut sets: Vec<String> = vec![];
    let mut owned: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    macro_rules! set_field {
        ($col:literal, $val:expr) => {
            if let Some(v) = $val {
                owned.push(Box::new(v.clone()));
                sets.push(format!("{} = ?{}", $col, owned.len()));
            }
        };
    }
    set_field!("occurred_at", &patch.date);
    set_field!("description", &patch.description);
    set_field!("kind", &patch.kind);
    set_field!("status", &patch.status);
    if let Some(v) = &patch.notes {
        owned.push(Box::new(v.clone()));
        sets.push(format!("notes = ?{}", owned.len()));
    }

    if !sets.is_empty() {
        owned.push(Box::new(id.to_string()));
        let sql = format!(
            "UPDATE transactions SET {} WHERE id = ?{}",
            sets.join(", "),
            owned.len()
        );
        let refs: Vec<&dyn rusqlite::ToSql> = owned.iter().map(|b| b.as_ref()).collect();
        tx.execute(&sql, refs.as_slice())?;
    }

    if let Some(entries) = &patch.entries {
        tx.execute("DELETE FROM entries WHERE transaction_id = ?1", params![id])?;
        insert_entries(&tx, id, entries)?;
    }

    tx.commit()
}

pub fn delete_transaction(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    // Explicit, not relying solely on ON DELETE CASCADE — see the doc
    // comment on the TS version this replaces.
    tx.execute("DELETE FROM entries WHERE transaction_id = ?1", params![id])?;
    tx.execute("DELETE FROM transactions WHERE id = ?1", params![id])?;
    tx.commit()
}

// ---------------------------------------------------------------------------
// Write: fx rates, currencies, settings
// ---------------------------------------------------------------------------

pub fn upsert_fx_rate(conn: &Connection, fx: &FxRate) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO fx_rates(base, quote, rate) VALUES (?1,?2,?3)
         ON CONFLICT(base, quote) DO UPDATE SET rate = excluded.rate",
        params![fx.base, fx.quote, fx.rate],
    )?;
    Ok(())
}

pub fn delete_fx_rate_for_base(conn: &Connection, base: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM fx_rates WHERE base = ?1", params![base])?;
    Ok(())
}

pub fn set_currency_enabled(conn: &Connection, code: &str, enabled: bool) -> rusqlite::Result<()> {
    if enabled {
        conn.execute(
            "INSERT INTO currencies(code) VALUES (?1) ON CONFLICT(code) DO NOTHING",
            params![code],
        )?;
    } else {
        conn.execute("DELETE FROM currencies WHERE code = ?1", params![code])?;
    }
    Ok(())
}

pub fn save_settings(conn: &Connection, s: &WorkspaceSettings) -> rusqlite::Result<()> {
    let json = serde_json::to_value(s).unwrap_or(Json::Null);
    set_setting(conn, "workspace_settings", &json)
}

// ---------------------------------------------------------------------------
// Wipe / bulk-insert / replace / seed / reset
// ---------------------------------------------------------------------------


/// Truncate every ledger table (data only). Used by replace_ledger, which
/// backs import, restore-from-backup and sync. Those flows replace the
/// *ledger*; they must not touch the PIN lock or the onboarding/tour flags.
fn wipe_ledger_data(tx: &SqlTransaction) -> rusqlite::Result<()> {
    // Order matters: children before parents.
    tx.execute("DELETE FROM entries", [])?;
    tx.execute("DELETE FROM transactions", [])?;
    tx.execute("DELETE FROM budget_lines", [])?;
    tx.execute("DELETE FROM budgets", [])?;
    tx.execute("DELETE FROM goals", [])?;
    tx.execute("DELETE FROM allocations", [])?;
    tx.execute("DELETE FROM categories", [])?;
    tx.execute("DELETE FROM financial_objects", [])?;
    tx.execute("DELETE FROM domains", [])?;
    tx.execute("DELETE FROM fx_rates", [])?;
    tx.execute("DELETE FROM currencies", [])?;
    Ok(())
}

/// Full workspace wipe for Settings > Reset workspace: ledger data plus the
/// settings that describe "is this workspace fresh / what gates it" (PIN,
/// onboarding, tour). Only reset_workspace should use this.
fn wipe_user_data(tx: &SqlTransaction) -> rusqlite::Result<()> {
    wipe_ledger_data(tx)?;
    tx.execute(
        "DELETE FROM settings WHERE key IN ('security_config', 'onboarding_state', 'tour_state')",
        [],
    )?;
    Ok(())
}

fn bulk_insert_ledger(tx: &SqlTransaction, s: &LedgerState) -> rusqlite::Result<()> {
    for code in &s.currencies {
        tx.execute(
            "INSERT INTO currencies(code) VALUES (?1) ON CONFLICT(code) DO NOTHING",
            params![code],
        )?;
    }
    for fx in &s.fx {
        tx.execute(
            "INSERT INTO fx_rates(base, quote, rate) VALUES (?1,?2,?3)
             ON CONFLICT(base, quote) DO UPDATE SET rate = excluded.rate",
            params![fx.base, fx.quote, fx.rate],
        )?;
    }
    for d in &s.domains {
        tx.execute(
            "INSERT INTO domains(id, name, kind, display_currency, description) VALUES (?1,?2,?3,?4,?5)",
            params![d.id, d.name, d.kind, d.display_currency, d.description],
        )?;
    }
    for o in &s.objects {
        tx.execute(
            "INSERT INTO financial_objects
               (id, domain_id, name, institution, kind, currency,
                interest_rate, min_payment, credit_limit, due_day)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                o.id,
                o.domain_id,
                o.name,
                o.institution,
                o.kind,
                o.currency,
                to_rate_minor(o.interest_rate),
                to_money_minor(o.min_payment),
                to_money_minor(o.credit_limit),
                o.due_day,
            ],
        )?;
    }
    for c in &s.categories {
        tx.execute(
            "INSERT INTO categories(id, name, parent_id, type) VALUES (?1,?2,?3,?4)",
            params![c.id, c.name, c.parent_id, c.kind],
        )?;
    }
    for a in &s.allocations {
        tx.execute(
            "INSERT INTO allocations(id, domain_id, name, target, target_currency) VALUES (?1,?2,?3,?4,?5)",
            params![a.id, a.domain_id, a.name, to_money_minor(a.target), a.target_currency],
        )?;
    }
    for g in &s.goals {
        tx.execute(
            "INSERT INTO goals(id, domain_id, name, target, currency, deadline,
                               priority, linked_allocation_id, notes)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                g.id,
                g.domain_id,
                g.name,
                to_money_minor(Some(g.target)),
                g.currency,
                g.deadline,
                g.priority,
                g.linked_allocation_id,
                g.notes,
            ],
        )?;
    }
    for b in &s.budgets {
        tx.execute(
            "INSERT INTO budgets(id, domain_id, month, currency) VALUES (?1,?2,?3,?4)",
            params![b.id, b.domain_id, b.month, b.currency],
        )?;
        for line in &b.lines {
            tx.execute(
                "INSERT INTO budget_lines(budget_id, category_id, amount) VALUES (?1,?2,?3)",
                params![b.id, line.category_id, to_money_minor(Some(line.amount))],
            )?;
        }
    }
    for t in &s.transactions {
        tx.execute(
            "INSERT INTO transactions(id, occurred_at, description, kind, status, notes)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![t.id, t.date, t.description, t.kind, t.status, t.notes],
        )?;
        insert_entries(tx, &t.id, &t.entries)?;
    }
    if let Some(settings) = &s.settings {
        let json = serde_json::to_string(settings).unwrap_or_else(|_| "null".to_string());
        tx.execute(
            "INSERT INTO settings(key, value_json) VALUES (?1,?2) \
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params!["workspace_settings", json],
        )?;
    }
    Ok(())
}

/// Make a ledger that arrived from outside (sync merge, import, backup
/// restore) internally consistent before it is written: dangling references
/// are dropped or cleared instead of being inserted. Without this, the entry
/// reference triggers from migration 0002 would abort the whole replace (and so
/// the whole sync) because one device deleted an account another device still
/// had entries for.
pub fn sanitize_ledger(s: &mut LedgerState) {
    use std::collections::HashSet;
    // The built-in "personal" workspace is created locally on first run, so data
    // pulled from the cloud can arrive before it exists on a fresh device. That
    // is not a dangling reference: recreate it instead of discarding everything
    // that belongs to it.
    let refs_personal = s.objects.iter().any(|o| o.domain_id == "personal")
        || s.allocations.iter().any(|a| a.domain_id == "personal")
        || s.goals.iter().any(|g| g.domain_id == "personal")
        || s.budgets.iter().any(|b| b.domain_id == "personal");
    if refs_personal && !s.domains.iter().any(|d| d.id == "personal") {
        s.domains.push(baseline_ledger().domains[0].clone());
    }
    let domain_ids: HashSet<String> = s.domains.iter().map(|d| d.id.clone()).collect();
    s.objects.retain(|o| domain_ids.contains(&o.domain_id));
    s.allocations.retain(|a| domain_ids.contains(&a.domain_id));
    s.goals.retain(|g| domain_ids.contains(&g.domain_id));
    s.budgets.retain(|b| domain_ids.contains(&b.domain_id));

    let cat_ids: HashSet<String> = s.categories.iter().map(|c| c.id.clone()).collect();
    for c in s.categories.iter_mut() {
        if matches!(&c.parent_id, Some(p) if !cat_ids.contains(p) || p == &c.id) {
            c.parent_id = None;
        }
    }
    let object_ids: HashSet<String> = s.objects.iter().map(|o| o.id.clone()).collect();
    let alloc_ids: HashSet<String> = s.allocations.iter().map(|a| a.id.clone()).collect();
    let goal_ids: HashSet<String> = s.goals.iter().map(|g| g.id.clone()).collect();
    for g in s.goals.iter_mut() {
        if matches!(&g.linked_allocation_id, Some(a) if !alloc_ids.contains(a)) {
            g.linked_allocation_id = None;
        }
    }
    for b in s.budgets.iter_mut() {
        b.lines.retain(|l| cat_ids.contains(&l.category_id));
    }

    let mut dropped = 0usize;
    for t in s.transactions.iter_mut() {
        let before = t.entries.len();
        t.entries.retain(|e| object_ids.contains(&e.object_id));
        dropped += before - t.entries.len();
        // A transaction that lost one leg but kept another (e.g. the other
        // device deleted the receiving account) is one-sided now. Void it with
        // a note, exactly as a local account deletion does (detach_objects), so
        // every device ends up with the same result from the same data.
        if t.entries.len() < before && !t.entries.is_empty() {
            t.status = Some("void".into());
            t.notes = Some(match t.notes.take() {
                Some(n) if !n.is_empty() => format!("{n} | Voided: counterpart account was deleted"),
                _ => "Voided: counterpart account was deleted".to_string(),
            });
        }
        for e in t.entries.iter_mut() {
            if matches!(&e.category_id, Some(c) if !cat_ids.contains(c)) { e.category_id = None; }
            if matches!(&e.allocation_id, Some(a) if !alloc_ids.contains(a)) { e.allocation_id = None; }
            if matches!(&e.goal_id, Some(g) if !goal_ids.contains(g)) { e.goal_id = None; }
        }
    }
    s.transactions.retain(|t| !t.entries.is_empty());
    if dropped > 0 {
        eprintln!("[sanitize_ledger] dropped {dropped} entr(ies) that pointed at missing accounts");
    }
}

pub fn replace_ledger(conn: &mut Connection, s: &LedgerState) -> rusqlite::Result<()> {
    let mut clean = s.clone();
    sanitize_ledger(&mut clean);
    let tx = conn.transaction()?;
    wipe_ledger_data(&tx)?;
    bulk_insert_ledger(&tx, &clean)?;
    tx.commit()
}

/// The only row the app creates on its own. The UI addresses the built-in
/// domain by the fixed id "personal", so it has to exist for anything to be
/// added at all. It is an empty container: no accounts, categories,
/// transactions, budgets, goals or exchange rates are ever generated.
fn baseline_ledger() -> LedgerState {
    LedgerState {
        currencies: vec![],
        fx: vec![],
        domains: vec![Domain {
            id: "personal".to_string(),
            name: "Personal".to_string(),
            kind: "personal".to_string(),
            display_currency: None,
            description: None,
        }],
        objects: vec![],
        categories: vec![],
        allocations: vec![],
        goals: vec![],
        budgets: vec![],
        transactions: vec![],
        settings: None,
    }
}

/// First run only: make sure the built-in Personal domain exists and mark the
/// workspace initialised. Strictly additive — it never removes or replaces
/// rows, because data may already be here (for example pulled from the cloud
/// before the workspace was ever opened). Returns true iff it ran.
pub fn ensure_initialized(conn: &mut Connection) -> rusqlite::Result<bool> {
    let marker = get_setting(conn, "workspace_initialized")?;
    if matches!(marker, Some(Json::Bool(true))) {
        return Ok(false);
    }
    let tx = conn.transaction()?;
    let existing = select_ledger_state(&tx)?;
    if !existing.domains.iter().any(|d| d.id == "personal") {
        insert_domain(&tx, &baseline_ledger().domains[0])?;
    }
    let json = serde_json::to_string(&Json::Bool(true)).unwrap();
    tx.execute(
        "INSERT INTO settings(key, value_json) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        params!["workspace_initialized", json],
    )?;
    tx.commit()?;
    Ok(true)
}

/// Settings > Reset workspace: wipe everything (including PIN, onboarding and
/// tour state) and return to the empty baseline. Nothing is re-populated.
pub fn reset_workspace(conn: &mut Connection) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    wipe_user_data(&tx)?;
    bulk_insert_ledger(&tx, &baseline_ledger())?;
    tx.commit()
}

// ---------------------------------------------------------------------------
// Cloud sync: apply entities pulled from the server
// ---------------------------------------------------------------------------

/// One entity as it arrives from the cloud: `kind` + `id` identify it (for
/// `fx` the id is the base currency; `settings` and `currencies` are
/// singletons with id "_"), `data` is its JSON body, `deleted` marks a
/// tombstone.
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteChange {
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub data: Option<Json>,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct ApplyResult {
    pub applied: usize,
    /// Rows that could not be understood (unknown kind or malformed body).
    /// They are skipped rather than failing the whole batch, and reported so
    /// the caller can surface it.
    pub skipped: usize,
}

fn upsert_by_id<T, F: Fn(&T) -> &str>(items: &mut Vec<T>, id: &str, item: Option<T>, key: F) {
    items.retain(|x| key(x) != id);
    if let Some(it) = item {
        items.push(it);
    }
}

/// Apply a batch of pulled changes in ONE transaction, entirely on the Rust
/// side: read the current ledger, fold the changes in, and write it back.
/// Doing this here (not as JS-side replace) means a sync can never clobber an
/// edit the user made while it was in flight — the Mutex orders them — and
/// the PIN / onboarding / tour settings are untouched (wipe_ledger_data).
pub fn apply_remote_changes(conn: &mut Connection, changes: &[RemoteChange]) -> rusqlite::Result<ApplyResult> {
    let tx = conn.transaction()?;
    let mut st = select_ledger_state(&tx)?;
    let mut out = ApplyResult::default();

    macro_rules! typed {
        ($ty:ty, $c:expr) => {
            if $c.deleted {
                Some(None)
            } else {
                match $c.data.clone().map(serde_json::from_value::<$ty>) {
                    Some(Ok(v)) => Some(Some(v)),
                    _ => None,
                }
            }
        };
    }

    for c in changes {
        let ok = match c.kind.as_str() {
            "domain" => typed!(Domain, c).map(|v| upsert_by_id(&mut st.domains, &c.id, v, |x| &x.id)).is_some(),
            "object" => typed!(FinancialObject, c).map(|v| upsert_by_id(&mut st.objects, &c.id, v, |x| &x.id)).is_some(),
            "category" => typed!(Category, c).map(|v| upsert_by_id(&mut st.categories, &c.id, v, |x| &x.id)).is_some(),
            "allocation" => typed!(Allocation, c).map(|v| upsert_by_id(&mut st.allocations, &c.id, v, |x| &x.id)).is_some(),
            "goal" => typed!(Goal, c).map(|v| upsert_by_id(&mut st.goals, &c.id, v, |x| &x.id)).is_some(),
            "budget" => typed!(Budget, c).map(|v| upsert_by_id(&mut st.budgets, &c.id, v, |x| &x.id)).is_some(),
            "transaction" => typed!(Transaction, c).map(|v| upsert_by_id(&mut st.transactions, &c.id, v, |x| &x.id)).is_some(),
            "fx" => typed!(FxRate, c)
                .map(|v| {
                    st.fx.retain(|x| x.base != c.id);
                    if let Some(rate) = v {
                        st.fx.push(rate);
                    }
                })
                .is_some(),
            "settings" => typed!(WorkspaceSettings, c)
                .map(|v| {
                    if v.is_some() {
                        st.settings = v;
                    }
                })
                .is_some(),
            "currencies" => typed!(Vec<String>, c)
                .map(|v| {
                    if let Some(list) = v {
                        st.currencies = list;
                    }
                })
                .is_some(),
            _ => false,
        };
        if ok {
            out.applied += 1;
        } else {
            out.skipped += 1;
        }
    }

    if out.applied > 0 {
        // Another device may have deleted an account (or goal, category...) that
        // an entry on THIS device still points at. Written as-is, the entry
        // reference triggers (migration 0002) would abort the whole batch, and
        // the same batch would fail again on every later sync. Drop the dangling
        // references first.
        sanitize_ledger(&mut st);
        wipe_ledger_data(&tx)?;
        bulk_insert_ledger(&tx, &st)?;
    }
    tx.commit()?;
    Ok(out)
}

// ---------------------------------------------------------------------------
// Tauri commands — thin wrappers: lock the connection, call the function
// above, map errors to String (Tauri's command error convention).
// ---------------------------------------------------------------------------

fn lock<'a>(state: &'a tauri::State<'a, DbState>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(|e| format!("db lock poisoned: {e}"))
}

#[tauri::command]
pub fn db_ensure_initialized(state: tauri::State<DbState>) -> Result<bool, String> {
    let mut conn = lock(&state)?;
    ensure_initialized(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_select_ledger_state(state: tauri::State<DbState>) -> Result<LedgerState, String> {
    let conn = lock(&state)?;
    select_ledger_state(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_insert_domain(state: tauri::State<DbState>, domain: Domain) -> Result<(), String> {
    let conn = lock(&state)?;
    insert_domain(&conn, &domain).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_domain(
    state: tauri::State<DbState>,
    id: String,
    patch: DomainPatch,
) -> Result<(), String> {
    let conn = lock(&state)?;
    update_domain(&conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_domain(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let mut conn = lock(&state)?;
    delete_domain(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_insert_object(state: tauri::State<DbState>, object: FinancialObject) -> Result<(), String> {
    let conn = lock(&state)?;
    insert_object(&conn, &object).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_object(
    state: tauri::State<DbState>,
    id: String,
    patch: ObjectPatch,
) -> Result<(), String> {
    let conn = lock(&state)?;
    update_object(&conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_object(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let mut conn = lock(&state)?;
    delete_object(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_insert_allocation(state: tauri::State<DbState>, allocation: Allocation) -> Result<(), String> {
    let conn = lock(&state)?;
    insert_allocation(&conn, &allocation).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_insert_goal(state: tauri::State<DbState>, goal: Goal) -> Result<(), String> {
    let conn = lock(&state)?;
    insert_goal(&conn, &goal).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_insert_budget(state: tauri::State<DbState>, budget: Budget) -> Result<(), String> {
    let mut conn = lock(&state)?;
    insert_budget(&mut conn, &budget).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_insert_category(state: tauri::State<DbState>, category: Category) -> Result<(), String> {
    let conn = lock(&state)?;
    insert_category(&conn, &category).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_insert_transaction(state: tauri::State<DbState>, transaction: Transaction) -> Result<(), String> {
    let mut conn = lock(&state)?;
    insert_transaction(&mut conn, &transaction).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_transaction(
    state: tauri::State<DbState>,
    id: String,
    patch: TransactionPatch,
) -> Result<(), String> {
    let mut conn = lock(&state)?;
    update_transaction(&mut conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_transaction(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let mut conn = lock(&state)?;
    delete_transaction(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_upsert_fx_rate(state: tauri::State<DbState>, fx: FxRate) -> Result<(), String> {
    let conn = lock(&state)?;
    upsert_fx_rate(&conn, &fx).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_fx_rate_for_base(state: tauri::State<DbState>, base: String) -> Result<(), String> {
    let conn = lock(&state)?;
    delete_fx_rate_for_base(&conn, &base).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_set_currency_enabled(
    state: tauri::State<DbState>,
    code: String,
    enabled: bool,
) -> Result<(), String> {
    let conn = lock(&state)?;
    set_currency_enabled(&conn, &code, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_settings(state: tauri::State<DbState>, settings: WorkspaceSettings) -> Result<(), String> {
    let conn = lock(&state)?;
    save_settings(&conn, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_setting(state: tauri::State<DbState>, key: String) -> Result<Option<Json>, String> {
    let conn = lock(&state)?;
    get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_set_setting(state: tauri::State<DbState>, key: String, value: Json) -> Result<(), String> {
    let conn = lock(&state)?;
    set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_goal(state: tauri::State<DbState>, id: String, patch: GoalPatch) -> Result<(), String> {
    let conn = lock(&state)?;
    update_goal(&conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_goal(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let mut conn = lock(&state)?;
    delete_goal(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_allocation(state: tauri::State<DbState>, id: String, patch: AllocationPatch) -> Result<(), String> {
    let conn = lock(&state)?;
    update_allocation(&conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_allocation(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let mut conn = lock(&state)?;
    delete_allocation(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_budget(state: tauri::State<DbState>, budget: Budget) -> Result<(), String> {
    let mut conn = lock(&state)?;
    update_budget(&mut conn, &budget).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_budget(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let mut conn = lock(&state)?;
    delete_budget(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_category(state: tauri::State<DbState>, id: String, patch: CategoryPatch) -> Result<(), String> {
    let conn = lock(&state)?;
    update_category(&conn, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_category(state: tauri::State<DbState>, id: String, reassign_to: Option<String>) -> Result<(), String> {
    let mut conn = lock(&state)?;
    delete_category(&mut conn, &id, reassign_to.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_replace_ledger(state: tauri::State<DbState>, ledger: LedgerState) -> Result<(), String> {
    let mut conn = lock(&state)?;
    replace_ledger(&mut conn, &ledger).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_apply_remote_changes(
    state: tauri::State<DbState>,
    changes: Vec<RemoteChange>,
) -> Result<ApplyResult, String> {
    let mut conn = lock(&state)?;
    apply_remote_changes(&mut conn, &changes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_reset_workspace(state: tauri::State<DbState>) -> Result<(), String> {
    let mut conn = lock(&state)?;
    reset_workspace(&mut conn).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tests — mirror the scenarios already proven in
// apps/desktop/src/test/db.test.ts (same logic, same SQL; that suite ran
// green against better-sqlite3 before this port). NOT run by me — no Rust
// toolchain was available in the environment this was written in. Run
// `cargo test` to actually verify these.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&mut conn).expect("run migrations");
        conn
    }

    fn empty_state() -> LedgerState {
        LedgerState {
            currencies: vec!["NGN".into(), "USD".into()],
            fx: vec![FxRate { base: "USD".into(), quote: "NGN".into(), rate: 1500.0 }],
            domains: vec![Domain {
                id: "dom_p".into(),
                name: "Personal".into(),
                kind: "personal".into(),
                display_currency: None,
                description: None,
            }],
            objects: vec![FinancialObject {
                id: "obj_wallet".into(),
                domain_id: "dom_p".into(),
                name: "Wallet".into(),
                institution: None,
                kind: "cash".into(),
                currency: "NGN".into(),
                interest_rate: None,
                min_payment: None,
                credit_limit: None,
                due_day: None,
            }],
            categories: vec![Category {
                id: "cat_food".into(),
                name: "Food".into(),
                parent_id: None,
                kind: "expense".into(),
            }],
            allocations: vec![],
            goals: vec![],
            budgets: vec![],
            transactions: vec![],
            settings: None,
        }
    }

    #[test]
    fn round_trips_a_transaction() {
        let mut conn = test_conn();
        replace_ledger(&mut conn, &empty_state()).unwrap();
        insert_transaction(
            &mut conn,
            &Transaction {
                id: "tx1".into(),
                date: "2025-01-15".into(),
                description: "Lunch".into(),
                kind: "expense".into(),
                status: Some("cleared".into()),
                notes: None,
                entries: vec![Entry {
                    object_id: "obj_wallet".into(),
                    amount: -12.5,
                    category_id: Some("cat_food".into()),
                    allocation_id: None,
                    goal_id: None,
                }],
            },
        )
        .unwrap();

        let state = select_ledger_state(&conn).unwrap();
        assert_eq!(state.transactions.len(), 1);
        assert_eq!(state.transactions[0].entries.len(), 1);
        assert!((state.transactions[0].entries[0].amount - (-12.5)).abs() < 1e-9);
    }

    #[test]
    fn delete_transaction_leaves_no_orphaned_entries() {
        let mut conn = test_conn();
        replace_ledger(&mut conn, &empty_state()).unwrap();
        insert_transaction(
            &mut conn,
            &Transaction {
                id: "tx_del".into(),
                date: "2025-01-15".into(),
                description: "x".into(),
                kind: "expense".into(),
                status: None,
                notes: None,
                entries: vec![Entry {
                    object_id: "obj_wallet".into(),
                    amount: -1.0,
                    category_id: None,
                    allocation_id: None,
                    goal_id: None,
                }],
            },
        )
        .unwrap();
        delete_transaction(&mut conn, "tx_del").unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entries WHERE transaction_id = ?1",
                params!["tx_del"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_domain_cascades_without_orphans() {
        let mut conn = test_conn();
        replace_ledger(&mut conn, &empty_state()).unwrap();
        insert_budget(
            &mut conn,
            &Budget {
                id: "bud_del".into(),
                domain_id: "dom_p".into(),
                month: "2025-01".into(),
                currency: "NGN".into(),
                lines: vec![BudgetLine { category_id: "cat_food".into(), amount: 100.0 }],
            },
        )
        .unwrap();
        insert_transaction(
            &mut conn,
            &Transaction {
                id: "tx_in_domain".into(),
                date: "2025-01-15".into(),
                description: "x".into(),
                kind: "expense".into(),
                status: None,
                notes: None,
                entries: vec![Entry {
                    object_id: "obj_wallet".into(),
                    amount: -1.0,
                    category_id: None,
                    allocation_id: None,
                    goal_id: None,
                }],
            },
        )
        .unwrap();

        delete_domain(&mut conn, "dom_p").unwrap();

        let entries: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entries WHERE transaction_id = ?1",
                params!["tx_in_domain"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(entries, 0);
        let lines: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM budget_lines WHERE budget_id = ?1",
                params!["bud_del"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lines, 0);
    }

    #[test]
    fn domain_display_currency_and_description_persist_and_clear() {
        let mut conn = test_conn();
        replace_ledger(&mut conn, &empty_state()).unwrap();
        insert_domain(
            &conn,
            &Domain {
                id: "dom_biz".into(),
                name: "Business".into(),
                kind: "business".into(),
                display_currency: Some("USD".into()),
                description: Some("Atlas LLC".into()),
            },
        )
        .unwrap();

        let state = select_ledger_state(&conn).unwrap();
        let biz = state.domains.iter().find(|d| d.id == "dom_biz").unwrap();
        assert_eq!(biz.display_currency.as_deref(), Some("USD"));
        assert_eq!(biz.description.as_deref(), Some("Atlas LLC"));

        // Partial patch: only name — displayCurrency/description untouched.
        let mut extra = HashMap::new();
        update_domain(
            &conn,
            "dom_biz",
            &DomainPatch { name: Some("Atlas".into()), kind: None, extra: extra.clone() },
        )
        .unwrap();
        let state = select_ledger_state(&conn).unwrap();
        let biz = state.domains.iter().find(|d| d.id == "dom_biz").unwrap();
        assert_eq!(biz.name, "Atlas");
        assert_eq!(biz.display_currency.as_deref(), Some("USD")); // untouched

        // Explicit null clears displayCurrency; description key absent = untouched.
        extra.insert("displayCurrency".to_string(), Json::Null);
        update_domain(&conn, "dom_biz", &DomainPatch { name: None, kind: None, extra }).unwrap();
        let state = select_ledger_state(&conn).unwrap();
        let biz = state.domains.iter().find(|d| d.id == "dom_biz").unwrap();
        assert_eq!(biz.display_currency, None); // cleared
        assert_eq!(biz.description.as_deref(), Some("Atlas LLC")); // still untouched
    }

    #[test]
    fn first_run_creates_only_an_empty_personal_domain() {
        let mut conn = test_conn();
        assert!(ensure_initialized(&mut conn).unwrap(), "first call initialises");
        assert!(!ensure_initialized(&mut conn).unwrap(), "second call is a no-op");
        let st = select_ledger_state(&conn).unwrap();
        assert_eq!(st.domains.len(), 1);
        assert_eq!(st.domains[0].id, "personal");
        assert!(st.objects.is_empty());
        assert!(st.categories.is_empty());
        assert!(st.transactions.is_empty());
        assert!(st.allocations.is_empty());
        assert!(st.goals.is_empty());
        assert!(st.budgets.is_empty());
        assert!(st.fx.is_empty(), "no exchange rates may be invented");
        assert!(st.currencies.is_empty());
    }

    #[test]
    fn initialising_never_overwrites_data_that_is_already_there() {
        let mut conn = test_conn();
        // Cloud data arrives BEFORE the workspace was ever initialised.
        let changes: Vec<RemoteChange> = serde_json::from_value(serde_json::json!([
            {"kind":"domain","id":"personal","data":{"id":"personal","name":"Home","kind":"personal"}},
            {"kind":"object","id":"o1","data":{"id":"o1","domainId":"personal","name":"Cash","kind":"cash","currency":"USD"}}
        ])).unwrap();
        apply_remote_changes(&mut conn, &changes).unwrap();

        assert!(ensure_initialized(&mut conn).unwrap());
        let st = select_ledger_state(&conn).unwrap();
        assert_eq!(st.objects.len(), 1, "synced account must survive initialisation");
        assert_eq!(st.domains.len(), 1);
        assert_eq!(st.domains[0].name, "Home", "synced Personal domain must not be replaced");
    }

    #[test]
    fn reset_returns_to_the_same_empty_baseline() {
        let mut conn = test_conn();
        ensure_initialized(&mut conn).unwrap();
        reset_workspace(&mut conn).unwrap();
        let st = select_ledger_state(&conn).unwrap();
        assert_eq!(st.domains.len(), 1);
        assert!(st.objects.is_empty() && st.transactions.is_empty() && st.fx.is_empty());
    }

    #[test]
    fn apply_remote_changes_folds_in_upserts_and_tombstones_atomically() {
        let mut conn = test_conn();
        ensure_initialized(&mut conn).unwrap();
        // user-owned settings that a sync must never touch
        set_setting(&conn, "security_config", &serde_json::json!({"pinHash": "x"})).unwrap();
        set_setting(&conn, "onboarding_state", &serde_json::json!({"complete": true})).unwrap();

        let changes: Vec<RemoteChange> = serde_json::from_value(serde_json::json!([
            {"kind":"object","id":"o1","data":{"id":"o1","domainId":"personal","name":"Cash","kind":"cash","currency":"USD"}},
            {"kind":"transaction","id":"t1","data":{"id":"t1","date":"2026-01-02","description":"Coffee","kind":"expense","entries":[{"objectId":"o1","amount":-3.5}]}},
            {"kind":"fx","id":"NGN","data":{"base":"NGN","quote":"USD","rate":0.001}},
            {"kind":"currencies","id":"_","data":["USD","NGN"]},
            {"kind":"bogus","id":"z","data":{}},
            {"kind":"goal","id":"g1","data":{"not":"a goal"}}
        ])).unwrap();
        let r = apply_remote_changes(&mut conn, &changes).unwrap();
        assert_eq!(r, ApplyResult { applied: 4, skipped: 2 });

        let st = select_ledger_state(&conn).unwrap();
        assert_eq!(st.objects.len(), 1);
        assert_eq!(st.transactions.len(), 1);
        assert_eq!(st.fx.len(), 1);
        assert_eq!(st.currencies, vec!["NGN".to_string(), "USD".to_string()]);
        assert!(st.goals.is_empty(), "malformed goal must not be applied");
        assert!(get_setting(&conn, "security_config").unwrap().is_some(), "PIN untouched");
        assert!(get_setting(&conn, "onboarding_state").unwrap().is_some(), "onboarding untouched");

        // tombstones remove; a re-upsert replaces rather than duplicates
        let changes: Vec<RemoteChange> = serde_json::from_value(serde_json::json!([
            {"kind":"transaction","id":"t1","deleted":true},
            {"kind":"object","id":"o1","data":{"id":"o1","domainId":"personal","name":"Wallet","kind":"cash","currency":"USD"}},
            {"kind":"fx","id":"NGN","deleted":true}
        ])).unwrap();
        apply_remote_changes(&mut conn, &changes).unwrap();
        let st = select_ledger_state(&conn).unwrap();
        assert!(st.transactions.is_empty());
        assert_eq!(st.objects.len(), 1);
        assert_eq!(st.objects[0].name, "Wallet");
        assert!(st.fx.is_empty());
    }

    #[test]
    fn apply_remote_changes_with_nothing_applicable_leaves_data_alone() {
        let mut conn = test_conn();
        ensure_initialized(&mut conn).unwrap();
        let r = apply_remote_changes(&mut conn, &[]).unwrap();
        assert_eq!(r, ApplyResult { applied: 0, skipped: 0 });
        assert_eq!(select_ledger_state(&conn).unwrap().domains.len(), 1);
    }

    #[test]
    fn money_and_rate_round_trip_through_minor_units() {
        assert_eq!(to_money_minor(Some(19.99)), Some(1999));
        assert_eq!(from_money_minor(Some(1999)), Some(19.99));
        assert_eq!(to_money_minor(None), None);

        assert_eq!(to_rate_minor(Some(0.00066)), Some(660));
        assert_eq!(from_rate_minor(Some(660)), Some(0.00066));
    }

    #[test]
    fn replace_ledger_keeps_pin_and_onboarding_but_reset_clears_them() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();
        let ledger: LedgerState = serde_json::from_str(
            r#"{"currencies":["USD"],"fx":[],"domains":[{"id":"personal","name":"Personal","kind":"personal"}],
                "objects":[],"categories":[],"allocations":[],"goals":[],"budgets":[],"transactions":[]}"#,
        )
        .unwrap();
        for k in ["security_config", "onboarding_state", "tour_state"] {
            set_setting(&conn, k, &serde_json::json!({ "marker": k })).unwrap();
        }
        // import / restore / sync path
        replace_ledger(&mut conn, &ledger).unwrap();
        for k in ["security_config", "onboarding_state", "tour_state"] {
            assert!(get_setting(&conn, k).unwrap().is_some(), "{k} must survive replace_ledger");
        }
        // Settings > Reset workspace path
        reset_workspace(&mut conn).unwrap();
        for k in ["security_config", "onboarding_state", "tour_state"] {
            assert!(get_setting(&conn, k).unwrap().is_none(), "{k} must be cleared by reset_workspace");
        }

    }

    // ---- audit-fix regression tests -------------------------------------

    fn mk_obj(id: &str, dom: &str, kind: &str) -> FinancialObject {
        FinancialObject { id: id.into(), domain_id: dom.into(), name: id.into(), institution: Some("Bank".into()), kind: kind.into(), currency: "NGN".into(), interest_rate: None, min_payment: None, credit_limit: Some(500000.0), due_day: Some(5) }
    }
    fn two_domain_ledger() -> LedgerState {
        LedgerState {
            currencies: vec!["NGN".into()],
            fx: vec![FxRate { base: "NGN".into(), quote: "USD".into(), rate: 1.0 / 1550.0 }],
            domains: vec![
                Domain { id: "personal".into(), name: "Personal".into(), kind: "personal".into(), display_currency: None, description: None },
                Domain { id: "biz".into(), name: "Biz".into(), kind: "business".into(), display_currency: None, description: None },
            ],
            objects: vec![mk_obj("a", "personal", "account"), mk_obj("b", "biz", "account")],
            categories: vec![], allocations: vec![], goals: vec![], budgets: vec![], transactions: vec![], settings: None,
        }
    }
    fn entry(obj: &str, amt: f64) -> Entry {
        Entry { object_id: obj.into(), amount: amt, category_id: None, allocation_id: None, goal_id: None }
    }
    fn tx_of(id: &str, kind: &str, entries: Vec<Entry>) -> Transaction {
        Transaction { id: id.into(), date: "2026-09-01".into(), description: id.into(), kind: kind.into(), status: None, notes: None, entries }
    }

    #[test]
    fn fx_rate_keeps_full_precision() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        replace_ledger(&mut c, &two_domain_ledger()).unwrap();
        let back = select_ledger_state(&c).unwrap().fx[0].rate;
        assert!((back - 1.0 / 1550.0).abs() < 1e-15, "got {back}");
    }

    #[test]
    fn deleting_an_account_voids_half_transfers_and_spares_unrelated_rows() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        replace_ledger(&mut c, &two_domain_ledger()).unwrap();
        insert_transaction(&mut c, &tx_of("xfer", "transfer", vec![entry("a", -1000.0), entry("b", 1000.0)])).unwrap();
        insert_transaction(&mut c, &tx_of("only_a", "income", vec![entry("a", 50.0)])).unwrap();
        c.execute("INSERT INTO transactions(id, occurred_at, description, kind) VALUES ('empty','2026-09-01','no entries','income')", []).unwrap();
        delete_object(&mut c, "a").unwrap();
        let st = select_ledger_state(&c).unwrap();
        assert!(st.transactions.iter().all(|t| t.id != "only_a"), "wholly-owned tx must be deleted");
        let x = st.transactions.iter().find(|t| t.id == "xfer").expect("transfer history kept");
        assert_eq!(x.status.as_deref(), Some("void"));
        assert!(x.notes.as_deref().unwrap_or("").contains("counterpart"));
        assert_eq!(x.entries.len(), 1);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM transactions WHERE id='empty'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "unrelated entry-less tx must survive");
        let bal: i64 = c.query_row("SELECT COALESCE(SUM(balance_minor),0) FROM v_object_balances WHERE object_id='b'", [], |r| r.get(0)).unwrap();
        assert_eq!(bal, 0, "void leg must not count toward the survivor's balance (view excludes void)");
    }

    #[test]
    fn object_patch_can_clear_optional_fields() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        replace_ledger(&mut c, &two_domain_ledger()).unwrap();
        let untouched: ObjectPatch = serde_json::from_str(r#"{"name":"renamed"}"#).unwrap();
        update_object(&c, "a", &untouched).unwrap();
        let st = select_ledger_state(&c).unwrap();
        let o = st.objects.iter().find(|o| o.id == "a").unwrap();
        assert_eq!((o.name.as_str(), o.credit_limit, o.institution.as_deref()), ("renamed", Some(500000.0), Some("Bank")));
        let clear: ObjectPatch = serde_json::from_str(r#"{"creditLimit":null,"institution":null,"dueDay":null}"#).unwrap();
        update_object(&c, "a", &clear).unwrap();
        let st = select_ledger_state(&c).unwrap();
        let o = st.objects.iter().find(|o| o.id == "a").unwrap();
        assert_eq!((o.credit_limit, o.institution.clone(), o.due_day), (None, None, None));
    }

    #[test]
    fn entries_cannot_point_at_missing_rows_but_replace_ledger_sanitizes_instead_of_failing() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        replace_ledger(&mut c, &two_domain_ledger()).unwrap();
        let bad = insert_transaction(&mut c, &tx_of("ghost", "expense", vec![entry("nope", -5.0)]));
        assert!(bad.is_err(), "trigger must reject an entry on a nonexistent object");
        // a merged ledger that still references a deleted account must not abort the sync
        let mut l = two_domain_ledger();
        let mut dangling = tx_of("t_dangling", "expense", vec![entry("a", -1.0)]);
        dangling.entries[0].category_id = Some("cat_gone".into());
        l.transactions = vec![dangling, tx_of("t_orphan", "expense", vec![entry("deleted_elsewhere", -9.0)])];
        replace_ledger(&mut c, &l).unwrap();
        let st = select_ledger_state(&c).unwrap();
        assert_eq!(st.transactions.len(), 1);
        assert_eq!(st.transactions[0].entries[0].category_id, None);
    }

    #[test]
    fn goal_allocation_category_delete_leave_no_dangling_tags() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        let mut l = two_domain_ledger();
        l.categories = vec![
            Category { id: "c1".into(), name: "Food".into(), parent_id: None, kind: "expense".into() },
            Category { id: "c2".into(), name: "Dining".into(), parent_id: Some("c1".into()), kind: "expense".into() },
        ];
        l.allocations = vec![Allocation { id: "al".into(), domain_id: "personal".into(), name: "Rainy".into(), target: Some(100.0), target_currency: "NGN".into() }];
        l.goals = vec![Goal { id: "g".into(), domain_id: "personal".into(), name: "Car".into(), target: 1000.0, currency: "NGN".into(), deadline: "2027-01-01".into(), priority: None, linked_allocation_id: Some("al".into()), notes: None }];
        let mut e = entry("a", -10.0);
        e.category_id = Some("c2".into()); e.allocation_id = Some("al".into()); e.goal_id = Some("g".into());
        l.transactions = vec![tx_of("t1", "expense", vec![e])];
        l.budgets = vec![Budget { id: "b1".into(), domain_id: "personal".into(), month: "2026-09".into(), currency: "NGN".into(), lines: vec![BudgetLine { category_id: "c1".into(), amount: 50.0 }, BudgetLine { category_id: "c2".into(), amount: 20.0 }] }];
        replace_ledger(&mut c, &l).unwrap();

        delete_category(&mut c, "c2", Some("c1")).unwrap(); // merge Dining -> Food
        let st = select_ledger_state(&c).unwrap();
        assert_eq!(st.transactions[0].entries[0].category_id.as_deref(), Some("c1"));
        assert_eq!(st.budgets[0].lines.len(), 1);
        assert_eq!(st.budgets[0].lines[0].amount, 70.0, "merged budget lines are summed");

        delete_goal(&mut c, "g").unwrap();
        delete_allocation(&mut c, "al").unwrap();
        let st = select_ledger_state(&c).unwrap();
        let e = &st.transactions[0].entries[0];
        assert_eq!((e.goal_id.clone(), e.allocation_id.clone()), (None, None));
        assert!(st.goals.is_empty() && st.allocations.is_empty());
        delete_budget(&mut c, "b1").unwrap();
        assert!(select_ledger_state(&c).unwrap().budgets.is_empty());
    }

    #[test]
    fn remote_deletion_of_an_account_cannot_poison_the_sync() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        replace_ledger(&mut c, &two_domain_ledger()).unwrap();
        insert_transaction(&mut c, &tx_of("xfer", "transfer", vec![entry("a", -1000.0), entry("b", 1000.0)])).unwrap();
        insert_transaction(&mut c, &tx_of("solo", "income", vec![entry("a", 5.0)])).unwrap();
        // the other device deleted account "a"
        let r = apply_remote_changes(&mut c, &[RemoteChange { kind: "object".into(), id: "a".into(), data: None, deleted: true }]);
        assert!(r.is_ok(), "must not abort on dangling entries: {r:?}");
        let st = select_ledger_state(&c).unwrap();
        assert!(st.objects.iter().all(|o| o.id != "a"));
        assert!(st.transactions.iter().all(|t| t.id != "solo"), "wholly-owned tx is dropped");
        let x = st.transactions.iter().find(|t| t.id == "xfer").unwrap();
        assert_eq!(x.status.as_deref(), Some("void"));
        assert_eq!(x.entries.len(), 1);
    }

    #[test]
    fn cloud_data_arriving_before_the_personal_domain_exists_is_kept() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap(); // fresh device: no domains yet
        let obj = serde_json::to_value(mk_obj("sav", "personal", "account")).unwrap();
        let t = serde_json::to_value(tx_of("salary", "income", vec![entry("sav", 100.0)])).unwrap();
        let r = apply_remote_changes(&mut c, &[
            RemoteChange { kind: "object".into(), id: "sav".into(), data: Some(obj), deleted: false },
            RemoteChange { kind: "transaction".into(), id: "salary".into(), data: Some(t), deleted: false },
        ]).unwrap();
        assert_eq!(r.applied, 2);
        let st = select_ledger_state(&c).unwrap();
        assert_eq!(st.objects.len(), 1, "synced account must survive");
        assert_eq!(st.transactions.len(), 1, "synced transaction must survive");
        assert!(st.domains.iter().any(|d| d.id == "personal"));
    }
}

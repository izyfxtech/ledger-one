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
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Connection>);

// ---------------------------------------------------------------------------
// Money / rate unit conversion — mirrors packages/db/src/money.ts exactly.
// Amounts are stored as integer minor units (×100); rates as integer
// micro-units (×1_000_000). Both round-half-away-from-zero via f64::round.
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
    #[serde(default)]
    pub institution: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub interest_rate: Option<f64>,
    #[serde(default)]
    pub min_payment: Option<f64>,
    #[serde(default)]
    pub credit_limit: Option<f64>,
    #[serde(default)]
    pub due_day: Option<i64>,
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
    #[serde(default)]
    pub notes: Option<String>,
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
            let rate: i64 = row.get("rate")?;
            out.push(FxRate {
                base: row.get("base")?,
                quote: row.get("quote")?,
                rate: from_rate_minor(Some(rate)).unwrap_or(0.0),
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
        let rows = stmt.query_map(params![id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    if !object_ids.is_empty() {
        let placeholders = in_placeholders(object_ids.len());

        let doomed_tx_ids: Vec<String> = {
            let sql = format!(
                "SELECT t.id FROM transactions t
                 WHERE NOT EXISTS (
                   SELECT 1 FROM entries e
                   WHERE e.transaction_id = t.id
                     AND e.object_id NOT IN ({placeholders})
                 )"
            );
            let mut stmt = tx.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(object_ids.iter()), |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        if !doomed_tx_ids.is_empty() {
            let doomed_placeholders = in_placeholders(doomed_tx_ids.len());
            tx.execute(
                &format!("DELETE FROM entries WHERE transaction_id IN ({doomed_placeholders})"),
                rusqlite::params_from_iter(doomed_tx_ids.iter()),
            )?;
            tx.execute(
                &format!("DELETE FROM transactions WHERE id IN ({doomed_placeholders})"),
                rusqlite::params_from_iter(doomed_tx_ids.iter()),
            )?;
        }

        tx.execute(
            &format!("DELETE FROM entries WHERE object_id IN ({placeholders})"),
            rusqlite::params_from_iter(object_ids.iter()),
        )?;
    }

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

/// Builds `?1, ?2, ..., ?n` for a dynamic-length IN (...) clause.
fn in_placeholders(n: usize) -> String {
    (1..=n).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ")
}

// ---------------------------------------------------------------------------
// Write: financial_objects
// ---------------------------------------------------------------------------

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

    macro_rules! set_field {
        ($col:literal, $val:expr) => {
            if let Some(v) = $val {
                owned.push(Box::new(v.clone()));
                sets.push(format!("{} = ?{}", $col, owned.len()));
            }
        };
    }
    set_field!("domain_id", &patch.domain_id);
    set_field!("name", &patch.name);
    set_field!("institution", &patch.institution);
    set_field!("kind", &patch.kind);
    set_field!("currency", &patch.currency);
    if let Some(v) = patch.interest_rate {
        owned.push(Box::new(to_rate_minor(Some(v))));
        sets.push(format!("interest_rate = ?{}", owned.len()));
    }
    if let Some(v) = patch.min_payment {
        owned.push(Box::new(to_money_minor(Some(v))));
        sets.push(format!("min_payment = ?{}", owned.len()));
    }
    if let Some(v) = patch.credit_limit {
        owned.push(Box::new(to_money_minor(Some(v))));
        sets.push(format!("credit_limit = ?{}", owned.len()));
    }
    if let Some(v) = patch.due_day {
        owned.push(Box::new(v));
        sets.push(format!("due_day = ?{}", owned.len()));
    }

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

pub fn delete_object(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM transactions WHERE id IN (
           SELECT t.id FROM transactions t
           WHERE NOT EXISTS (
             SELECT 1 FROM entries e
             WHERE e.transaction_id = t.id AND e.object_id <> ?1
           )
         )",
        params![id],
    )?;
    tx.execute("DELETE FROM entries WHERE object_id = ?1", params![id])?;
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
    set_field!("notes", &patch.notes);

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
        params![fx.base, fx.quote, to_rate_minor(Some(fx.rate))],
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

/// Bundled demo/seed ledger — embedded at compile time. Used both by
/// ensure_seeded() (first run) and reset_workspace() (Settings > Reset
/// workspace), so the data lives in exactly one place.
const SEED_LEDGER_JSON: &str = include_str!("../resources/ledger-seed.json");

/// Truncate every user-owned table. Used by replace_ledger (import,
/// restore-from-backup, reset).
fn wipe_user_data(tx: &SqlTransaction) -> rusqlite::Result<()> {
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

    // Settings that describe "is this workspace fresh / what gates it" must
    // be wiped alongside the data they describe — see the TS version this
    // replaces for the full reasoning (the PIN-survives-reinstall bug and
    // the onboarding-skipped-on-reset bug both came from this living
    // scattered across call sites instead of here).
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
            params![fx.base, fx.quote, to_rate_minor(Some(fx.rate))],
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

pub fn replace_ledger(conn: &mut Connection, s: &LedgerState) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    wipe_user_data(&tx)?;
    bulk_insert_ledger(&tx, s)?;
    tx.commit()
}

/// If the database has never been seeded (no `workspace_initialized`
/// setting), parse the embedded demo seed and insert it, marking the
/// workspace initialized in the same transaction so a crash mid-seed
/// leaves a clean re-seed state on next boot. Returns true iff it ran.
pub fn ensure_seeded(conn: &mut Connection) -> rusqlite::Result<bool> {
    let marker = get_setting(conn, "workspace_initialized")?;
    if matches!(marker, Some(Json::Bool(true))) {
        return Ok(false);
    }

    let seed: LedgerState = match serde_json::from_str(SEED_LEDGER_JSON) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[ensure_seeded] seed JSON failed to parse: {e}");
            set_setting(conn, "workspace_initialized", &Json::Bool(true))?;
            return Ok(false);
        }
    };

    if seed.domains.is_empty() {
        // Nothing to seed (empty resource) — mark initialized anyway so we
        // don't retry every boot; an empty ledger is a valid starting point.
        set_setting(conn, "workspace_initialized", &Json::Bool(true))?;
        return Ok(false);
    }

    let tx = conn.transaction()?;
    bulk_insert_ledger(&tx, &seed)?;
    let json = serde_json::to_string(&Json::Bool(true)).unwrap();
    tx.execute(
        "INSERT INTO settings(key, value_json) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        params!["workspace_initialized", json],
    )?;
    tx.commit()?;
    Ok(true)
}

/// Settings > Reset workspace: wipe everything and re-seed the same demo
/// data ensure_seeded() would install on a fresh workspace (matches the
/// pre-migration behavior — reset restores the starter demo data, not an
/// empty ledger).
pub fn reset_workspace(conn: &mut Connection) -> rusqlite::Result<()> {
    let seed: LedgerState = serde_json::from_str(SEED_LEDGER_JSON).unwrap_or(LedgerState {
        currencies: vec![],
        fx: vec![],
        domains: vec![],
        objects: vec![],
        categories: vec![],
        allocations: vec![],
        goals: vec![],
        budgets: vec![],
        transactions: vec![],
        settings: None,
    });
    let tx = conn.transaction()?;
    wipe_user_data(&tx)?;
    bulk_insert_ledger(&tx, &seed)?;
    tx.commit()
}

// ---------------------------------------------------------------------------
// Tauri commands — thin wrappers: lock the connection, call the function
// above, map errors to String (Tauri's command error convention).
// ---------------------------------------------------------------------------

fn lock<'a>(state: &'a tauri::State<'a, DbState>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(|e| format!("db lock poisoned: {e}"))
}

#[tauri::command]
pub fn db_ensure_seeded(state: tauri::State<DbState>) -> Result<bool, String> {
    let mut conn = lock(&state)?;
    ensure_seeded(&mut conn).map_err(|e| e.to_string())
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
pub fn db_replace_ledger(state: tauri::State<DbState>, ledger: LedgerState) -> Result<(), String> {
    let mut conn = lock(&state)?;
    replace_ledger(&mut conn, &ledger).map_err(|e| e.to_string())
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
    fn ensure_seeded_only_runs_once() {
        let mut conn = test_conn();
        let ran_first = ensure_seeded(&mut conn).unwrap();
        let ran_second = ensure_seeded(&mut conn).unwrap();
        assert!(ran_first, "first call should seed");
        assert!(!ran_second, "second call should be a no-op");
    }

    #[test]
    fn money_and_rate_round_trip_through_minor_units() {
        assert_eq!(to_money_minor(Some(19.99)), Some(1999));
        assert_eq!(from_money_minor(Some(1999)), Some(19.99));
        assert_eq!(to_money_minor(None), None);

        assert_eq!(to_rate_minor(Some(0.00066)), Some(660));
        assert_eq!(from_rate_minor(Some(660)), Some(0.00066));
    }
}

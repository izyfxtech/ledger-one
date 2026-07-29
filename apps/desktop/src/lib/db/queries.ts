// Thin invoke() wrappers around the Rust-owned persistence layer
// (src-tauri/src/db.rs). Previously these functions sent raw SQL strings
// to @tauri-apps/plugin-sql over IPC; now Rust owns the actual SQL, and
// this file just calls typed commands.
import { invoke } from "@tauri-apps/api/core";
import type {
  Allocation,
  Budget,
  Category,
  CurrencyCode,
  Domain,
  FxRate,
  Goal,
  LedgerState,
  Transaction,
  WorkspaceSettings,
} from "@/lib/ledger/types";
import type { FinancialObject } from "@/lib/ledger/types";

// ---------- settings KV ----------

export async function getSetting(key: string): Promise<unknown | null> {
  return invoke("db_get_setting", { key });
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await invoke("db_set_setting", { key, value });
}

// ---------- hydrate ----------

export async function selectLedgerState(): Promise<LedgerState> {
  return invoke("db_select_ledger_state");
}

// ---------- domains ----------

export async function insertDomain(d: Domain): Promise<void> {
  await invoke("db_insert_domain", { domain: d });
}

export async function updateDomain(
  id: string,
  patch: Partial<Omit<Domain, "id">>,
): Promise<void> {
  // The Rust side needs to tell "key omitted" (don't touch) from "key
  // explicitly present as null" (clear back to inherited/empty) for
  // displayCurrency/description — see DomainPatch's doc comment in db.rs.
  // JSON.stringify (which `invoke` uses under the hood) drops
  // `undefined`-valued keys entirely, so we can't just pass `patch`
  // through as-is: we have to check `"key" in patch` *here*, while we
  // still have the real JS object, and translate an explicit `undefined`
  // into an explicit `null` before it's serialized.
  const wire: Record<string, unknown> = {};
  if ("name" in patch) wire.name = patch.name;
  if ("kind" in patch) wire.kind = patch.kind;
  if ("displayCurrency" in patch) wire.displayCurrency = patch.displayCurrency ?? null;
  if ("description" in patch) wire.description = patch.description ?? null;
  await invoke("db_update_domain", { id, patch: wire });
}

export async function deleteDomain(id: string): Promise<void> {
  await invoke("db_delete_domain", { id });
}

// ---------- financial objects (accounts) ----------

export async function insertObject(o: FinancialObject): Promise<void> {
  await invoke("db_insert_object", { object: o });
}

export async function updateObject(
  id: string,
  patch: Partial<Omit<FinancialObject, "id">>,
): Promise<void> {
  // Standard "omit to skip" semantics throughout — `undefined` being
  // dropped by JSON serialization is already the correct behavior here
  // (unlike updateDomain above, nothing in this patch ever needs to
  // distinguish "omitted" from "explicitly cleared").
  await invoke("db_update_object", { id, patch });
}

export async function deleteObject(id: string): Promise<void> {
  await invoke("db_delete_object", { id });
}

// ---------- allocations, goals, budgets, categories ----------

export async function insertAllocation(a: Allocation): Promise<void> {
  await invoke("db_insert_allocation", { allocation: a });
}

export async function insertGoal(g: Goal): Promise<void> {
  await invoke("db_insert_goal", { goal: g });
}

export async function insertBudget(b: Budget): Promise<void> {
  await invoke("db_insert_budget", { budget: b });
}

export async function insertCategory(c: Category): Promise<void> {
  await invoke("db_insert_category", { category: c });
}

// ---------- transactions ----------

export async function insertTransaction(t: Transaction): Promise<void> {
  await invoke("db_insert_transaction", { transaction: t });
}

export async function updateTransaction(
  id: string,
  patch: Partial<Omit<Transaction, "id">>,
): Promise<void> {
  await invoke("db_update_transaction", { id, patch });
}

export async function deleteTransaction(id: string): Promise<void> {
  await invoke("db_delete_transaction", { id });
}

// ---------- fx rates, currencies, settings ----------

export async function upsertFxRate(fx: FxRate): Promise<void> {
  await invoke("db_upsert_fx_rate", { fx });
}

export async function deleteFxRatesForBase(base: CurrencyCode): Promise<void> {
  await invoke("db_delete_fx_rate_for_base", { base });
}

export async function setCurrencyEnabled(
  code: CurrencyCode,
  enabled: boolean,
): Promise<void> {
  await invoke("db_set_currency_enabled", { code, enabled });
}

export async function saveSettings(s: WorkspaceSettings): Promise<void> {
  await invoke("db_save_settings", { settings: s });
}

// ---------- whole-state operations ----------

/** Replace-semantics: wipes every user-owned table, then bulk-inserts `s`.
 *  Used by importState/replaceState/reset in store.tsx. */
export async function replaceLedger(s: LedgerState): Promise<void> {
  await invoke("db_replace_ledger", { ledger: s });
}

/** Settings > Reset workspace: wipes and re-seeds the demo data (the same
 *  data ensureSeeded() would install on a fresh workspace). */
export async function resetWorkspace(): Promise<void> {
  await invoke("db_reset_workspace");
}

/** If the database has never been seeded, bulk-inserts the compile-time-
 *  embedded demo seed and marks the workspace initialized. Returns true
 *  iff it actually ran. Safe to call on every boot. */
export async function ensureSeeded(): Promise<boolean> {
  return invoke("db_ensure_seeded");
}

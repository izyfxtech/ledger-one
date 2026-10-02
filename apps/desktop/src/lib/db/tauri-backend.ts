// Thin invoke() wrappers around the Rust-owned persistence layer
// (src-tauri/src/db.rs). Previously these functions sent raw SQL strings
// to @tauri-apps/plugin-sql over IPC; now Rust owns the actual SQL, and
// this file just calls typed commands.
import { invoke } from "@tauri-apps/api/core";
import type { ApplyResult, LedgerBackend, RemoteChange } from "./backend";
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
import { CLEARABLE } from "@/lib/ledger/mutations";

/** JSON drops `undefined`, but for clearable fields an explicit `undefined`
 *  means "clear it", which the Rust patch structs read as `null`
 *  (see double_option in db.rs). Check `in patch` while we still have the
 *  real JS object. */
function wire<T extends object>(patch: T, clearable: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  for (const k of clearable)
    if (k in patch && (patch as Record<string, unknown>)[k] === undefined) out[k] = null;
  return out;
}

/** Desktop backend: every call is a typed Tauri command backed by rusqlite
 *  (src-tauri/src/db.rs). */
export const tauriBackend: LedgerBackend = {
  // ---------- settings KV ----------

  async getSetting(key: string): Promise<unknown | null> {
    return invoke("db_get_setting", { key });
  },

  async setSetting(key: string, value: unknown): Promise<void> {
    await invoke("db_set_setting", { key, value });
  },

  // ---------- hydrate ----------

  async selectLedgerState(): Promise<LedgerState> {
    return invoke("db_select_ledger_state");
  },

  // ---------- domains ----------

  async insertDomain(d: Domain): Promise<void> {
    await invoke("db_insert_domain", { domain: d });
  },

  async updateDomain(id: string, patch: Partial<Omit<Domain, "id">>): Promise<void> {
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
  },

  async deleteDomain(id: string): Promise<void> {
    await invoke("db_delete_domain", { id });
  },

  // ---------- financial objects (accounts) ----------

  async insertObject(o: FinancialObject): Promise<void> {
    await invoke("db_insert_object", { object: o });
  },

  async updateObject(id: string, patch: Partial<Omit<FinancialObject, "id">>): Promise<void> {
    // institution / interestRate / minPayment / creditLimit / dueDay can be
    // cleared, so (like updateDomain) explicit `undefined` must become `null`.
    await invoke("db_update_object", { id, patch: wire(patch, CLEARABLE.object) });
  },

  async deleteObject(id: string): Promise<void> {
    await invoke("db_delete_object", { id });
  },

  // ---------- allocations, goals, budgets, categories ----------

  async insertAllocation(a: Allocation): Promise<void> {
    await invoke("db_insert_allocation", { allocation: a });
  },

  async insertGoal(g: Goal): Promise<void> {
    await invoke("db_insert_goal", { goal: g });
  },

  async insertBudget(b: Budget): Promise<void> {
    await invoke("db_insert_budget", { budget: b });
  },

  async insertCategory(c: Category): Promise<void> {
    await invoke("db_insert_category", { category: c });
  },
  async updateAllocation(id, patch) {
    await invoke("db_update_allocation", { id, patch: wire(patch, CLEARABLE.allocation) });
  },
  async deleteAllocation(id) {
    await invoke("db_delete_allocation", { id });
  },
  async updateGoal(id, patch) {
    await invoke("db_update_goal", { id, patch: wire(patch, CLEARABLE.goal) });
  },
  async deleteGoal(id) {
    await invoke("db_delete_goal", { id });
  },
  async updateBudget(b) {
    await invoke("db_update_budget", { budget: b });
  },
  async deleteBudget(id) {
    await invoke("db_delete_budget", { id });
  },
  async updateCategory(id, patch) {
    await invoke("db_update_category", { id, patch: wire(patch, CLEARABLE.category) });
  },
  async deleteCategory(id, reassignTo) {
    await invoke("db_delete_category", { id, reassignTo: reassignTo ?? null });
  },

  // ---------- transactions ----------

  async insertTransaction(t: Transaction): Promise<void> {
    await invoke("db_insert_transaction", { transaction: t });
  },

  async updateTransaction(id: string, patch: Partial<Omit<Transaction, "id">>): Promise<void> {
    await invoke("db_update_transaction", { id, patch: wire(patch, CLEARABLE.transaction) });
  },

  async deleteTransaction(id: string): Promise<void> {
    await invoke("db_delete_transaction", { id });
  },

  // ---------- fx rates, currencies, settings ----------

  async upsertFxRate(fx: FxRate): Promise<void> {
    await invoke("db_upsert_fx_rate", { fx });
  },

  async deleteFxRatesForBase(base: CurrencyCode): Promise<void> {
    await invoke("db_delete_fx_rate_for_base", { base });
  },

  async setCurrencyEnabled(code: CurrencyCode, enabled: boolean): Promise<void> {
    await invoke("db_set_currency_enabled", { code, enabled });
  },

  async saveSettings(s: WorkspaceSettings): Promise<void> {
    await invoke("db_save_settings", { settings: s });
  },

  // ---------- whole-state operations ----------

  /** Replace-semantics: wipes every user-owned table, then bulk-inserts `s`.
   *  Used by importState/replaceState/reset in store.tsx. */
  async replaceLedger(s: LedgerState): Promise<void> {
    await invoke("db_replace_ledger", { ledger: s });
  },

  /** Settings > Reset workspace: wipes everything and returns to the empty
   *  baseline (just the built-in Personal domain). Nothing is re-populated. */
  async resetWorkspace(): Promise<void> {
    await invoke("db_reset_workspace");
  },

  /** First run only: creates the empty baseline (the built-in Personal domain
   *  and nothing else — no demo accounts, transactions or exchange rates) and
   *  marks the workspace initialised. Returns true iff it actually ran. Safe to
   *  call on every boot. */
  async ensureInitialized(): Promise<boolean> {
    return invoke("db_ensure_initialized");
  },
  async applyRemoteChanges(changes: RemoteChange[]): Promise<ApplyResult> {
    return invoke("db_apply_remote_changes", { changes });
  },
};

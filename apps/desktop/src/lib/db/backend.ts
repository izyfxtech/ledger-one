import type {
  Allocation,
  Budget,
  Category,
  CurrencyCode,
  Domain,
  FinancialObject,
  FxRate,
  Goal,
  LedgerState,
  Transaction,
  WorkspaceSettings,
} from "@/lib/ledger/types";

/** One entity pulled from the cloud. `fx` ids are the base currency;
 *  `settings` and `currencies` are singletons with id "_". */
export type RemoteChange = {
  kind: string;
  id: string;
  data?: unknown;
  deleted?: boolean;
};

export type ApplyResult = { applied: number; skipped: number };

/**
 * The local database. Two implementations with identical behaviour:
 *  - tauri-backend.ts — rusqlite via Tauri commands (desktop)
 *  - web-backend.ts   — IndexedDB (browser)
 * Both are exercised by the same conformance tests where possible.
 */
export interface LedgerBackend {
  getSetting(key: string): Promise<unknown | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  selectLedgerState(): Promise<LedgerState>;

  insertDomain(d: Domain): Promise<void>;
  updateDomain(id: string, patch: Partial<Omit<Domain, "id">>): Promise<void>;
  deleteDomain(id: string): Promise<void>;

  insertObject(o: FinancialObject): Promise<void>;
  updateObject(id: string, patch: Partial<Omit<FinancialObject, "id">>): Promise<void>;
  deleteObject(id: string): Promise<void>;

  insertAllocation(a: Allocation): Promise<void>;
  updateAllocation(id: string, patch: Partial<Omit<Allocation, "id">>): Promise<void>;
  /** Entries tagged with it lose the tag; goals funded from it are unlinked. */
  deleteAllocation(id: string): Promise<void>;
  insertGoal(g: Goal): Promise<void>;
  updateGoal(id: string, patch: Partial<Omit<Goal, "id">>): Promise<void>;
  /** Entries tagged with it lose the tag. */
  deleteGoal(id: string): Promise<void>;
  insertBudget(b: Budget): Promise<void>;
  /** Replaces the budget's currency and lines (month and workspace are fixed). */
  updateBudget(b: Budget): Promise<void>;
  deleteBudget(id: string): Promise<void>;
  insertCategory(c: Category): Promise<void>;
  updateCategory(id: string, patch: Partial<Omit<Category, "id">>): Promise<void>;
  /** With `reassignTo` this is a merge (entries and budget lines move there). */
  deleteCategory(id: string, reassignTo?: string): Promise<void>;

  insertTransaction(t: Transaction): Promise<void>;
  updateTransaction(id: string, patch: Partial<Omit<Transaction, "id">>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;

  upsertFxRate(fx: FxRate): Promise<void>;
  deleteFxRatesForBase(base: CurrencyCode): Promise<void>;
  setCurrencyEnabled(code: CurrencyCode, enabled: boolean): Promise<void>;
  saveSettings(s: WorkspaceSettings): Promise<void>;

  replaceLedger(s: LedgerState): Promise<void>;
  resetWorkspace(): Promise<void>;
  ensureInitialized(): Promise<boolean>;

  /** Fold pulled cloud changes into the local ledger in one atomic step. */
  applyRemoteChanges(changes: RemoteChange[]): Promise<ApplyResult>;
}

/** True inside the Tauri desktop shell. */
export function isTauriRuntime(): boolean {
  return typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;
}

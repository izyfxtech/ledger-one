import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import * as db from "@/lib/db";
import { canPerform } from "@/lib/local-store";
import { diffLedgerState } from "@/lib/sync/diff";
import { outbox } from "@/lib/sync/outbox-instance";
import { syncHooks } from "@/lib/sync/signals";
import { queryClient } from "@/lib/query-client";
import {
  CLEARABLE,
  applyPatch,
  deleteAllocationFromState,
  deleteCategoryFromState,
  deleteDomainFromState,
  deleteGoalFromState,
  deleteObjectFromState,
} from "./mutations";
import { LEDGER_SCHEMA_VERSION, ledgerStateSchema, persistedSnapshotSchema } from "./schema";
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
} from "./types";

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  workspaceName: "My Workspace",
  defaultCurrency: "NGN",
  fiscalYearStart: "January",
  timezone: "Africa/Lagos",
  theme: "light",
  density: "comfortable",
};

// ---------------------------------------------------------------------------
// The ledger is a single query. First-run init (empty baseline) + hydration from
// SQLite happen in its queryFn, so a route loader can `ensureQueryData` it
// and every component can `useSuspenseQuery` it — no `ready` flag, no
// context provider, no hydrate effect.
// ---------------------------------------------------------------------------

export const ledgerKey = ["ledger"] as const;
const LEDGER_WRITE = ["ledger-write"] as const;

export const ledgerQuery = queryOptions({
  queryKey: ledgerKey,
  queryFn: async (): Promise<LedgerState> => {
    await db.ensureInitialized();
    return db.selectLedgerState();
  },
});

/** The whole ledger state, suspended until hydrated. */
export function useLedgerState(): LedgerState {
  return useSuspenseQuery(ledgerQuery).data;
}

export function parseSnapshot(raw: unknown): LedgerState | null {
  if (raw == null || typeof raw !== "object") return null;
  const enveloped = persistedSnapshotSchema.safeParse(raw);
  if (enveloped.success) return enveloped.data.state;
  const legacy = ledgerStateSchema.safeParse(raw);
  if (legacy.success) return legacy.data;
  return null;
}

function rid(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function requirePermission(action: "write" | "admin", what: string): void {
  if (canPerform(action)) return;
  const msg = action === "admin" ? `Only admins can ${what}.` : `Viewers can't ${what}.`;
  toast.error(msg);
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Sync bookkeeping: every local change to the cached ledger passes through
// `commit`, which queues the changed entities in the outbox. Changes that
// arrive from the cloud are applied in the database and picked up by a
// refetch, never through `commit`, so they aren't queued as local edits.
// ---------------------------------------------------------------------------

function commit(qc: QueryClient, next: LedgerState): LedgerState | undefined {
  const prev = qc.getQueryData<LedgerState>(ledgerKey);
  qc.setQueryData(ledgerKey, next);
  if (prev && prev !== next) {
    let changed = false;
    diffLedgerState(prev, next, (kind, id, action) => {
      outbox.markChanged(kind, id, action === "delete");
      changed = true;
    });
    if (changed) syncHooks.onLocalChange();
  }
  return prev;
}

// ---------------------------------------------------------------------------
// A generic optimistic mutation: permission check → optimistic cache write →
// SQLite write → on failure, roll the cache back (the old store had no
// rollback at all) and tell the user.
// ---------------------------------------------------------------------------

type Spec<V> = {
  what: string;
  permission: { level: "write" | "admin"; verb: string };
  apply: (s: LedgerState, v: V) => LedgerState;
  persist: (v: V) => Promise<unknown>;
};

function useLedgerMutation<V>(spec: Spec<V>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, V, { prev?: LedgerState }>({
    mutationKey: LEDGER_WRITE,
    // Same scope id = run one at a time, in the order they were issued. Without
    // it two quick writes (create an account, then its opening-balance
    // transaction) could reach the database in either order. Optimistic
    // updates (onMutate) still apply immediately; only the save is queued.
    scope: { id: "ledger-writes" },
    mutationFn: spec.persist,
    onMutate: async (v) => {
      requirePermission(spec.permission.level, spec.permission.verb);
      await qc.cancelQueries({ queryKey: ledgerKey });
      const cur = qc.getQueryData<LedgerState>(ledgerKey);
      if (!cur) return {};
      return { prev: commit(qc, spec.apply(cur, v)) };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ledgerKey, ctx.prev);
      console.error(`[ledger] failed to save ${spec.what}:`, err);
      if (ctx) toast.error(`Couldn't save ${spec.what} — change was reverted.`);
    },
    // Once the last in-flight write settles, re-read the database. The cache
    // then always matches what is on disk — including anything a cloud sync
    // applied in the meantime.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: LEDGER_WRITE }) === 1) {
        void qc.invalidateQueries({ queryKey: ledgerKey });
      }
    },
  });
}

const w = (verb: string) => ({ level: "write" as const, verb });
const a = (verb: string) => ({ level: "admin" as const, verb });

/** All ledger mutations. Same call shapes as the old context value. */
export function useLedgerActions() {
  const qc = useQueryClient();

  const addTx = useLedgerMutation<Transaction>({
    what: "transaction",
    permission: w("add transactions"),
    apply: (s, t) => ({ ...s, transactions: [t, ...s.transactions] }),
    persist: db.insertTransaction,
  });
  const updTx = useLedgerMutation<{ id: string; patch: Partial<Omit<Transaction, "id">> }>({
    what: "transaction",
    permission: w("edit transactions"),
    apply: (s, { id, patch }) => ({
      ...s,
      transactions: s.transactions.map((t) =>
        t.id === id ? applyPatch(t, patch, CLEARABLE.transaction) : t,
      ),
    }),
    persist: ({ id, patch }) => db.updateTransaction(id, patch),
  });
  const delTx = useLedgerMutation<string>({
    what: "transaction deletion",
    permission: w("delete transactions"),
    apply: (s, id) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) }),
    persist: db.deleteTransaction,
  });

  const addObj = useLedgerMutation<FinancialObject>({
    what: "account",
    permission: w("add accounts"),
    apply: (s, o) => ({ ...s, objects: [...s.objects, o] }),
    persist: db.insertObject,
  });
  const updObj = useLedgerMutation<{ id: string; patch: Partial<Omit<FinancialObject, "id">> }>({
    what: "account",
    permission: w("edit accounts"),
    apply: (s, { id, patch }) => ({
      ...s,
      objects: s.objects.map((o) => (o.id === id ? applyPatch(o, patch, CLEARABLE.object) : o)),
    }),
    persist: ({ id, patch }) => db.updateObject(id, patch),
  });
  const delObj = useLedgerMutation<string>({
    what: "account deletion",
    permission: w("delete accounts"),
    // Same rule as the databases: transactions only on this account go; a
    // transfer to another account stays but is voided with a note. Mirrored
    // here so the sync outbox sees exactly what was saved.
    apply: (s, id) => deleteObjectFromState(s, id),
    persist: db.deleteObject,
  });

  const addDom = useLedgerMutation<Domain>({
    what: "workspace",
    permission: w("add a domain"),
    apply: (s, d) => ({ ...s, domains: [...s.domains, d] }),
    persist: db.insertDomain,
  });
  const updDom = useLedgerMutation<{ id: string; patch: Partial<Omit<Domain, "id">> }>({
    what: "workspace",
    permission: w("edit domains"),
    apply: (s, { id, patch }) => ({
      ...s,
      domains: s.domains.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }),
    persist: ({ id, patch }) => db.updateDomain(id, patch),
  });
  const delDom = useLedgerMutation<string>({
    what: "workspace deletion",
    permission: w("delete domains"),
    apply: (s, id) => deleteDomainFromState(s, id),
    persist: db.deleteDomain,
  });

  const addAlloc = useLedgerMutation<Allocation>({
    what: "allocation",
    permission: w("add allocations"),
    apply: (s, x) => ({ ...s, allocations: [...s.allocations, x] }),
    persist: db.insertAllocation,
  });
  const addGoalM = useLedgerMutation<Goal>({
    what: "goal",
    permission: w("add goals"),
    apply: (s, g) => ({ ...s, goals: [...s.goals, g] }),
    persist: db.insertGoal,
  });
  const addBudgetM = useLedgerMutation<Budget>({
    what: "budget",
    permission: w("add budgets"),
    apply: (s, b) => ({ ...s, budgets: [...s.budgets, b] }),
    persist: db.insertBudget,
  });

  const updGoal = useLedgerMutation<{ id: string; patch: Partial<Omit<Goal, "id">> }>({
    what: "goal",
    permission: w("edit goals"),
    apply: (s, { id, patch }) => ({
      ...s,
      goals: s.goals.map((g) => (g.id === id ? applyPatch(g, patch, CLEARABLE.goal) : g)),
    }),
    persist: ({ id, patch }) => db.updateGoal(id, patch),
  });
  const delGoal = useLedgerMutation<string>({
    what: "goal deletion",
    permission: w("delete goals"),
    apply: (s, id) => deleteGoalFromState(s, id),
    persist: db.deleteGoal,
  });
  const updAlloc = useLedgerMutation<{ id: string; patch: Partial<Omit<Allocation, "id">> }>({
    what: "allocation",
    permission: w("edit allocations"),
    apply: (s, { id, patch }) => ({
      ...s,
      allocations: s.allocations.map((x) =>
        x.id === id ? applyPatch(x, patch, CLEARABLE.allocation) : x,
      ),
    }),
    persist: ({ id, patch }) => db.updateAllocation(id, patch),
  });
  const delAlloc = useLedgerMutation<string>({
    what: "allocation deletion",
    permission: w("delete allocations"),
    apply: (s, id) => deleteAllocationFromState(s, id),
    persist: db.deleteAllocation,
  });
  const updBudget = useLedgerMutation<Budget>({
    what: "budget",
    permission: w("edit budgets"),
    apply: (s, b) => ({
      ...s,
      budgets: s.budgets.map((x) =>
        x.id === b.id ? { ...x, currency: b.currency, lines: b.lines } : x,
      ),
    }),
    persist: db.updateBudget,
  });
  const delBudget = useLedgerMutation<string>({
    what: "budget deletion",
    permission: w("delete budgets"),
    apply: (s, id) => ({ ...s, budgets: s.budgets.filter((b) => b.id !== id) }),
    persist: db.deleteBudget,
  });
  const addCat = useLedgerMutation<Category>({
    what: "category",
    permission: w("add categories"),
    apply: (s, c) => ({ ...s, categories: [...s.categories, c] }),
    persist: db.insertCategory,
  });
  const updCat = useLedgerMutation<{ id: string; patch: Partial<Omit<Category, "id">> }>({
    what: "category",
    permission: w("edit categories"),
    apply: (s, { id, patch }) => ({
      ...s,
      categories: s.categories.map((c) =>
        c.id === id ? applyPatch(c, patch, CLEARABLE.category) : c,
      ),
    }),
    persist: ({ id, patch }) => db.updateCategory(id, patch),
  });
  const delCat = useLedgerMutation<{ id: string; reassignTo?: string }>({
    what: "category deletion",
    permission: w("delete categories"),
    apply: (s, { id, reassignTo }) => deleteCategoryFromState(s, id, reassignTo),
    persist: ({ id, reassignTo }) => db.deleteCategory(id, reassignTo),
  });

  const upsertFx = useLedgerMutation<FxRate>({
    what: "exchange rate",
    permission: a("edit exchange rates"),
    apply: (s, fx) => ({
      ...s,
      fx: s.fx.some((r) => r.base === fx.base)
        ? s.fx.map((r) => (r.base === fx.base ? fx : r))
        : [...s.fx, fx],
    }),
    persist: db.upsertFxRate,
  });
  const delFx = useLedgerMutation<CurrencyCode>({
    what: "exchange rate deletion",
    permission: a("delete exchange rates"),
    apply: (s, base) => ({ ...s, fx: s.fx.filter((r) => r.base !== base) }),
    persist: db.deleteFxRatesForBase,
  });
  const toggleCcy = useLedgerMutation<{ code: CurrencyCode; enabled: boolean }>({
    what: "currency settings",
    permission: a("change enabled currencies"),
    apply: (s, { code, enabled }) => {
      const has = s.currencies.includes(code);
      if (enabled && !has) return { ...s, currencies: [...s.currencies, code] };
      if (!enabled && has) return { ...s, currencies: s.currencies.filter((c) => c !== code) };
      return s;
    },
    persist: ({ code, enabled }) => db.setCurrencyEnabled(code, enabled),
  });
  // Persisting the *merged* settings object fixes the old updateSettings,
  // which read a value assigned inside a setState updater and could skip
  // the write under React batching.
  const updSettings = useLedgerMutation<WorkspaceSettings>({
    what: "settings",
    permission: a("change workspace settings"),
    apply: (s, merged) => ({ ...s, settings: merged }),
    persist: db.saveSettings,
  });

  // Whole-state operations: wait for SQLite first, then swap the cache.
  const replaceM = useMutation<void, Error, { next: LedgerState; level: string }>({
    mutationKey: LEDGER_WRITE,
    mutationFn: async ({ next }) => {
      await db.replaceLedger(next);
    },
    onSuccess: (_d, { next }) => {
      commit(qc, next);
      void qc.invalidateQueries({ queryKey: ledgerKey });
    },
  });
  const resetM = useMutation<void, Error, void>({
    mutationFn: async () => {
      await db.resetWorkspace();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ledgerKey }),
  });

  const current = () => {
    const s = qc.getQueryData<LedgerState>(ledgerKey);
    if (!s) throw new Error("Ledger not loaded");
    return s;
  };

  return {
    addTransaction(t: Omit<Transaction, "id">): Transaction {
      const next: Transaction = { id: rid("tx"), status: "cleared", ...t };
      addTx.mutate(next);
      return next;
    },
    updateTransaction: (id: string, patch: Partial<Omit<Transaction, "id">>) =>
      updTx.mutate({ id, patch }),
    deleteTransaction: (id: string) => delTx.mutate(id),

    addObject(o: Omit<FinancialObject, "id">): FinancialObject {
      const next: FinancialObject = { id: rid("obj"), ...o };
      addObj.mutate(next);
      return next;
    },
    updateObject: (id: string, patch: Partial<Omit<FinancialObject, "id">>) =>
      updObj.mutate({ id, patch }),
    deleteObject: (id: string) => delObj.mutate(id),

    addDomain(d: Omit<Domain, "id">): Domain {
      const next: Domain = { id: rid("dom"), ...d };
      addDom.mutate(next);
      return next;
    },
    updateDomain: (id: string, patch: Partial<Omit<Domain, "id">>) => updDom.mutate({ id, patch }),
    deleteDomain: (id: string) => delDom.mutate(id),

    addAllocation(x: Omit<Allocation, "id">): Allocation {
      const next: Allocation = { id: rid("alc"), ...x };
      addAlloc.mutate(next);
      return next;
    },
    addGoal(g: Omit<Goal, "id">): Goal {
      const next: Goal = { id: rid("goal"), ...g };
      addGoalM.mutate(next);
      return next;
    },
    addBudget(b: Omit<Budget, "id">): Budget {
      const next: Budget = { id: rid("bud"), ...b };
      addBudgetM.mutate(next);
      return next;
    },

    updateGoal: (id: string, patch: Partial<Omit<Goal, "id">>) => updGoal.mutate({ id, patch }),
    deleteGoal: (id: string) => delGoal.mutate(id),
    updateAllocation: (id: string, patch: Partial<Omit<Allocation, "id">>) =>
      updAlloc.mutate({ id, patch }),
    deleteAllocation: (id: string) => delAlloc.mutate(id),
    updateBudget(id: string, patch: Partial<Pick<Budget, "currency" | "lines">>) {
      const cur = current().budgets.find((b) => b.id === id);
      if (cur) updBudget.mutate({ ...cur, ...patch });
    },
    deleteBudget: (id: string) => delBudget.mutate(id),
    addCategory(c: Omit<Category, "id">): Category {
      const next: Category = { id: rid("cat"), ...c };
      addCat.mutate(next);
      return next;
    },
    updateCategory: (id: string, patch: Partial<Omit<Category, "id">>) =>
      updCat.mutate({ id, patch }),
    /** With `reassignTo` this is a merge: entries and budget lines move there. */
    deleteCategory: (id: string, reassignTo?: string) => delCat.mutate({ id, reassignTo }),

    upsertFxRate: (fx: FxRate) => upsertFx.mutate(fx),
    deleteFxRate: (base: CurrencyCode) => delFx.mutate(base),
    toggleCurrency: (code: CurrencyCode, enabled: boolean) => toggleCcy.mutate({ code, enabled }),
    updateSettings: (patch: Partial<WorkspaceSettings>) =>
      updSettings.mutate({ ...DEFAULT_SETTINGS, ...(current().settings ?? {}), ...patch }),

    async importState(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
      requirePermission("admin", "import a workspace");
      const parsed = ledgerStateSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: parsed.error.message };
      await replaceM.mutateAsync({ next: parsed.data, level: "import" });
      return { ok: true };
    },
    exportState: () =>
      JSON.stringify({ version: LEDGER_SCHEMA_VERSION, state: current() }, null, 2),
    async replaceState(next: LedgerState): Promise<void> {
      requirePermission("admin", "restore a backup");
      await replaceM.mutateAsync({ next, level: "restore" });
    },
    async reset(): Promise<void> {
      requirePermission("admin", "reset the workspace");
      await resetM.mutateAsync();
    },
  };
}

export type LedgerActions = ReturnType<typeof useLedgerActions>;

// ---------------------------------------------------------------------------
// Appearance (theme + density) is applied by subscribing to the query cache,
// not by effects inside a provider component.
// ---------------------------------------------------------------------------

const mq = () => window.matchMedia?.("(prefers-color-scheme: dark)");

function applyAppearance(settings: WorkspaceSettings | undefined) {
  const theme = settings?.theme ?? DEFAULT_SETTINGS.theme;
  const density = settings?.density ?? DEFAULT_SETTINGS.density;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark" || (theme === "system" && !!mq()?.matches));
  root.dataset.density = density;
}

export function installAppearance(qc: QueryClient = queryClient) {
  const apply = () => applyAppearance(qc.getQueryData<LedgerState>(ledgerKey)?.settings);
  qc.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.query.queryKey[0] === ledgerKey[0]) apply();
  });
  mq()?.addEventListener?.("change", apply);
  apply();
}

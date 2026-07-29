import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import * as db from "@/lib/db";
import { canPerform } from "@/lib/local-store";
import { diffLedgerState } from "@/lib/sync/diff";
import { stampUpdated, stampDeleted } from "@/lib/sync/meta-store";
import { syncNow as runSync, type SyncResult } from "@/lib/sync/client";
import { loadSyncConfig } from "@/lib/sync/account";
import { EMPTY_SEED } from "./seed";
import type {
  Allocation,
  Budget,
  CurrencyCode,
  Domain,
  FinancialObject,
  FxRate,
  Goal,
  LedgerState,
  Transaction,
  WorkspaceSettings,
} from "./types";
import { LEDGER_SCHEMA_VERSION, ledgerStateSchema, persistedSnapshotSchema } from "./schema";

// ---------------------------------------------------------------------------
// LedgerProvider — local-first, SQLite-persisted store.
//
// * The React context holds the entire LedgerState in memory for instant,
//   synchronous reads/renders.
// * On mount we `ensureSeeded()` (first-run only) then hydrate in-memory
//   state from SQLite via `selectLedgerState()`.
// * Each mutation updates in-memory state immediately (for instant UI
//   feedback) AND fires the matching granular SQL write in the background
//   (see @/lib/db/queries.ts) — a narrow INSERT/UPDATE/DELETE, not a
//   whole-ledger replace. `replaceLedger` (wipe + bulk reinsert) is
//   reserved for genuinely whole-state operations: import, restore-from-
//   backup, and reset.
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  workspaceName: "My Workspace",
  defaultCurrency: "NGN",
  fiscalYearStart: "January",
  timezone: "Africa/Lagos",
  theme: "light",
  density: "comfortable",
};

type LedgerContextValue = {
  state: LedgerState;
  ready: boolean;
  addTransaction: (t: Omit<Transaction, "id">) => Transaction;
  updateTransaction: (id: string, patch: Partial<Omit<Transaction, "id">>) => void;
  deleteTransaction: (id: string) => void;
  addObject: (o: Omit<FinancialObject, "id">) => FinancialObject;
  updateObject: (id: string, patch: Partial<Omit<FinancialObject, "id">>) => void;
  deleteObject: (id: string) => void;
  addDomain: (d: Omit<Domain, "id">) => Domain;
  updateDomain: (id: string, patch: Partial<Omit<Domain, "id">>) => void;
  deleteDomain: (id: string) => void;
  addAllocation: (a: Omit<Allocation, "id">) => Allocation;
  addGoal: (g: Omit<Goal, "id">) => Goal;
  addBudget: (b: Omit<Budget, "id">) => Budget;
  upsertFxRate: (fx: FxRate) => void;
  deleteFxRate: (base: CurrencyCode) => void;
  toggleCurrency: (code: CurrencyCode, enabled: boolean) => void;
  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
  importState: (raw: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
  exportState: () => string;
  replaceState: (next: LedgerState) => Promise<void>;
  reset: () => Promise<void>;
  /** Runs one sync cycle (see @/lib/sync/client) and, on success, applies
   *  the merged result to in-memory state immediately — same as every
   *  other mutation here, instant UI feedback rather than waiting on a
   *  separate re-hydration round trip. No-op-shaped failure (never
   *  throws) since sync is optional infrastructure, not a user action —
   *  callers check `.ok` rather than try/catch. */
  syncNow: () => Promise<SyncResult>;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function parseSnapshot(raw: unknown): LedgerState | null {
  if (raw == null || typeof raw !== "object") return null;
  const enveloped = persistedSnapshotSchema.safeParse(raw);
  if (enveloped.success) return enveloped.data.state;
  const legacy = ledgerStateSchema.safeParse(raw);
  if (legacy.success) return legacy.data;
  return null;
}

/** Fire a granular DB write in the background. In-memory state has already
 *  moved on by the time this resolves, so failures can't be recovered
 *  inline — surface them so the user knows a change didn't reach disk. */
function persist(op: Promise<void>, what: string) {
  op.catch((err) => {
    console.error(`[ledger] failed to save ${what}:`, err);
    toast.error(`Couldn't save ${what} — changes may be lost on restart.`);
  });
}

/**
 * Enforce the roles assignable in Settings → Users & Permissions (this used
 * to be purely organizational — nothing checked them before allowing a
 * change). Both toasts AND throws: the toast guarantees the user sees why
 * nothing happened even at call sites with no try/catch of their own; the
 * throw guarantees no code after the check runs (e.g. a call site showing
 * a "saved!" toast right after an `await` that never actually wrote
 * anything).
 */
function requirePermission(action: "write" | "admin", what: string): void {
  if (canPerform(action)) return;
  const msg = action === "admin" ? `Only admins can ${what}.` : `Viewers can't ${what}.`;
  toast.error(msg);
  throw new Error(msg);
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LedgerState>(() => EMPTY_SEED);
  const [ready, setReady] = useState(false);

  // Hydrate on mount: seed the database on first run, then load the real
  // ledger state from SQLite.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await db.ensureSeeded();
        const loaded = await db.selectLedgerState();
        if (!cancelled) {
          setState(loaded);
          setReady(true);
        }
      } catch (err) {
        console.error("[ledger] hydrate failed:", err);
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stamps sync metadata (see @/lib/sync) for every entity that changes,
  // from this single choke point rather than instrumenting each of the 15
  // mutation functions below individually — a future mutation added to
  // this file is covered automatically instead of silently falling
  // outside sync's notice. Skips the very first post-hydration state
  // (baseline only, nothing "changed" yet) so a fresh app launch doesn't
  // stamp every existing row as touched right now.
  const syncBaselineRef = useRef<LedgerState | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (syncBaselineRef.current == null) {
      syncBaselineRef.current = state;
      return;
    }
    if (syncBaselineRef.current !== state) {
      diffLedgerState(syncBaselineRef.current, state, (kind, id, action) => {
        if (action === "upsert") stampUpdated(kind, id);
        else stampDeleted(kind, id);
      });
      syncBaselineRef.current = state;
    }
  }, [state, ready]);

  // Auto-sync once, shortly after launch, if sync is enabled on this
  // device — otherwise sync would only ever run when someone remembers
  // to click "Sync now" in Settings, which defeats the point. Runs once
  // per app launch (not on a timer/interval — this is a desktop app that
  // gets relaunched often enough that "sync on open" covers the common
  // case without needing background polling while it's sitting open).
  // Deliberately silent on failure (e.g. offline, server unreachable) —
  // sync is optional infrastructure; a failed background attempt
  // shouldn't interrupt someone opening their ledger, and Settings shows
  // the real "last synced" status for anyone who wants to check.
  //
  // Known narrow race, accepted for v1: `state` is captured once when
  // this effect starts and used for the whole round trip. An edit made
  // by the user in the few hundred milliseconds while that network call
  // is in flight won't be included in what gets merged/pushed, and the
  // final `setState(result.state)` below will make it briefly *look*
  // like that edit vanished from the screen. It isn't actually lost —
  // it's still sitting in SQLite from its own mutation call, and the
  // next sync cycle picks it up normally — but it's a real, if unlikely,
  // display glitch. Closing it properly means re-merging against
  // whatever `state` has become by the time this promise resolves,
  // rather than trusting the stale closed-over copy; deferred rather
  // than adding that complexity speculatively.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (!ready || autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    (async () => {
      let cfg: ReturnType<typeof loadSyncConfig>;
      try {
        cfg = loadSyncConfig();
      } catch {
        return;
      }
      if (!cfg.enabled) return;
      const result = await runSync(state);
      if (result.ok) {
        syncBaselineRef.current = result.state; // see syncNow() below for why
        setState(result.state);
      } else {
        console.warn("[sync] auto-sync on launch failed:", result.error);
      }
    })();
  }, [ready]);

  // Apply theme to document root.
  const theme = state.settings?.theme ?? DEFAULT_SETTINGS.theme;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const apply = () => {
      const dark =
        theme === "dark" ||
        (theme === "system" &&
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", !!dark);
    };
    apply();
    if (theme === "system" && typeof window !== "undefined") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => apply();
      mq.addEventListener?.("change", handler);
      return () => mq.removeEventListener?.("change", handler);
    }
  }, [theme]);

  // Apply density to document root.
  const density = state.settings?.density ?? DEFAULT_SETTINGS.density;
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.density = density;
  }, [density]);

  const value = useMemo<LedgerContextValue>(
    () => ({
      state,
      ready,

      addTransaction(t) {
        requirePermission("write", "add transactions");
        const next: Transaction = { id: rid("tx"), status: "cleared", ...t };
        setState((s) => ({ ...s, transactions: [next, ...s.transactions] }));
        persist(db.insertTransaction(next), "transaction");
        return next;
      },
      updateTransaction(id, patch) {
        requirePermission("write", "edit transactions");
        setState((s) => ({
          ...s,
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, ...patch } : t,
          ),
        }));
        persist(db.updateTransaction(id, patch), "transaction");
      },
      deleteTransaction(id) {
        requirePermission("write", "delete transactions");
        setState((s) => ({
          ...s,
          transactions: s.transactions.filter((t) => t.id !== id),
        }));
        persist(db.deleteTransaction(id), "transaction deletion");
      },

      addObject(o) {
        requirePermission("write", "add accounts");
        const next: FinancialObject = { id: rid("obj"), ...o };
        setState((s) => ({ ...s, objects: [...s.objects, next] }));
        persist(db.insertObject(next), "account");
        return next;
      },
      updateObject(id, patch) {
        requirePermission("write", "edit accounts");
        setState((s) => ({
          ...s,
          objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
        }));
        persist(db.updateObject(id, patch), "account");
      },
      deleteObject(id) {
        requirePermission("write", "delete accounts");
        setState((s) => ({
          ...s,
          objects: s.objects.filter((o) => o.id !== id),
          transactions: s.transactions
            .map((t) => ({
              ...t,
              entries: t.entries.filter((e) => e.objectId !== id),
            }))
            .filter((t) => t.entries.length > 0),
        }));
        persist(db.deleteObject(id), "account deletion");
      },

      addDomain(d) {
        requirePermission("write", "add a domain");
        const next: Domain = { id: rid("dom"), ...d };
        setState((s) => ({ ...s, domains: [...s.domains, next] }));
        persist(db.insertDomain(next), "workspace");
        return next;
      },
      updateDomain(id, patch) {
        requirePermission("write", "edit domains");
        setState((s) => ({
          ...s,
          domains: s.domains.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        }));
        persist(db.updateDomain(id, patch), "workspace");
      },
      deleteDomain(id) {
        requirePermission("write", "delete domains");
        setState((s) => {
          const objectIds = new Set(
            s.objects.filter((o) => o.domainId === id).map((o) => o.id),
          );
          return {
            ...s,
            domains: s.domains.filter((d) => d.id !== id),
            objects: s.objects.filter((o) => o.domainId !== id),
            allocations: s.allocations.filter((a) => a.domainId !== id),
            goals: s.goals.filter((g) => g.domainId !== id),
            budgets: s.budgets.filter((b) => b.domainId !== id),
            transactions: s.transactions
              .map((t) => ({
                ...t,
                entries: t.entries.filter((e) => !objectIds.has(e.objectId)),
              }))
              .filter((t) => t.entries.length > 0),
          };
        });
        persist(db.deleteDomain(id), "workspace deletion");
      },

      addAllocation(a) {
        requirePermission("write", "add allocations");
        const next: Allocation = { id: rid("alc"), ...a };
        setState((s) => ({ ...s, allocations: [...s.allocations, next] }));
        persist(db.insertAllocation(next), "allocation");
        return next;
      },
      addGoal(g) {
        requirePermission("write", "add goals");
        const next: Goal = { id: rid("goal"), ...g };
        setState((s) => ({ ...s, goals: [...s.goals, next] }));
        persist(db.insertGoal(next), "goal");
        return next;
      },
      addBudget(b) {
        requirePermission("write", "add budgets");
        const next: Budget = { id: rid("bud"), ...b };
        setState((s) => ({ ...s, budgets: [...s.budgets, next] }));
        persist(db.insertBudget(next), "budget");
        return next;
      },

      upsertFxRate(fx) {
        requirePermission("admin", "edit exchange rates");
        setState((s) => {
          const existing = s.fx.some((r) => r.base === fx.base);
          return {
            ...s,
            fx: existing
              ? s.fx.map((r) => (r.base === fx.base ? fx : r))
              : [...s.fx, fx],
          };
        });
        persist(db.upsertFxRate(fx), "exchange rate");
      },
      deleteFxRate(base) {
        requirePermission("admin", "delete exchange rates");
        setState((s) => ({ ...s, fx: s.fx.filter((r) => r.base !== base) }));
        persist(db.deleteFxRatesForBase(base), "exchange rate deletion");
      },
      toggleCurrency(code, enabled) {
        requirePermission("admin", "change enabled currencies");
        setState((s) => {
          const has = s.currencies.includes(code);
          if (enabled && !has) return { ...s, currencies: [...s.currencies, code] };
          if (!enabled && has)
            return { ...s, currencies: s.currencies.filter((c) => c !== code) };
          return s;
        });
        persist(db.setCurrencyEnabled(code, enabled), "currency settings");
      },
      updateSettings(patch) {
        requirePermission("admin", "change workspace settings");
        let merged: WorkspaceSettings | undefined;
        setState((s) => {
          merged = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}), ...patch };
          return { ...s, settings: merged };
        });
        if (merged) persist(db.saveSettings(merged), "settings");
      },

      async importState(raw) {
        requirePermission("admin", "import a workspace");
        const parsed = ledgerStateSchema.safeParse(raw);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        setState(parsed.data);
        await db.replaceLedger(parsed.data);
        return { ok: true };
      },
      exportState() {
        return JSON.stringify(
          { version: LEDGER_SCHEMA_VERSION, state },
          null,
          2,
        );
      },
      async replaceState(next) {
        requirePermission("admin", "restore a backup");
        setState(next);
        await db.replaceLedger(next);
      },
      async reset() {
        requirePermission("admin", "reset the workspace");
        await db.resetWorkspace();
        const fresh = await db.selectLedgerState();
        setState(fresh);
      },
      async syncNow() {
        // Deliberately no requirePermission() here — sync reconciles
        // state across devices, it isn't a local user editing data
        // through the UI, so it isn't gated by Users & Permissions (see
        // client.ts's header comment for the same reasoning applied to
        // why it writes via db.replaceLedger directly).
        const result = await runSync(state);
        if (result.ok) {
          // client.ts already computed and saved the correct merged
          // SyncMeta itself (see saveSyncMeta inside syncNow()). Rebase
          // the diff baseline to the merged state *before* setState, so
          // the diff effect above sees no change to stamp — otherwise
          // every entity that arrived from the *other* device would get
          // re-stamped with a fresh "now" timestamp as if this device
          // had just edited it, corrupting the very timestamps merge
          // decisions depend on.
          syncBaselineRef.current = result.state;
          setState(result.state);
        }
        return result;
      },
    }),
    [state, ready],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger must be used within LedgerProvider");
  return ctx;
}

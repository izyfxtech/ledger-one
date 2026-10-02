// Browser backend: the whole local database is one document in IndexedDB.
//
// It mirrors the behaviour of the Rust/rusqlite backend (src-tauri/src/db.rs)
// operation for operation, including cascades and sort orders, so the rest of
// the app can't tell which one it is talking to.
//
// Every operation is a single read-modify-write inside one IndexedDB
// transaction (idb-keyval's `update`), so two tabs of the app can't lose each
// other's edits. After a write we ping other tabs over a BroadcastChannel so
// they can refetch.
import { createStore, get, update, type UseStore } from "idb-keyval";
import { entitySchemas } from "@/lib/ledger/schema";
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
import {
  CLEARABLE,
  applyPatch,
  deleteAllocationFromState,
  deleteCategoryFromState,
  deleteDomainFromState,
  deleteGoalFromState,
  deleteObjectFromState,
  sanitizeLedger,
} from "@/lib/ledger/mutations";
import type { ApplyResult, LedgerBackend, RemoteChange } from "./backend";

type Doc = {
  ledger: LedgerState;
  /** Same key/value settings table the desktop app keeps in SQLite. */
  settings: Record<string, unknown>;
};

const DOC_KEY = "doc";
const WORKSPACE_SETTINGS_KEY = "workspace_settings";

// ---- document helpers ----------------------------------------------------

const baseline = (): LedgerState => ({
  currencies: [],
  fx: [],
  domains: [{ id: "personal", name: "Personal", kind: "personal" }],
  objects: [],
  categories: [],
  allocations: [],
  goals: [],
  budgets: [],
  transactions: [],
});

const blank = (): Doc => ({
  ledger: { ...baseline(), domains: [] },
  settings: {},
});

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function addUnique<T extends { id: string }>(list: T[], item: T, what: string): T[] {
  if (list.some((x) => x.id === item.id)) throw new Error(`${what} ${item.id} already exists`);
  return [...list, item];
}

function foldChanges(doc: Doc, changes: RemoteChange[]): { doc: Doc; result: ApplyResult } {
  const st = doc.ledger;
  const result: ApplyResult = { applied: 0, skipped: 0 };

  const upsert = <T extends { id: string }>(list: T[], id: string, item: T | null): T[] => {
    const rest = list.filter((x) => x.id !== id);
    return item ? [...rest, item] : rest;
  };

  for (const c of changes) {
    const schema = entitySchemas[c.kind as keyof typeof entitySchemas];
    if (!schema) {
      result.skipped++;
      continue;
    }
    let value: unknown = null;
    if (!c.deleted) {
      const parsed = schema.safeParse(c.data);
      if (!parsed.success) {
        result.skipped++;
        continue;
      }
      value = parsed.data;
    }
    switch (c.kind) {
      case "domain":
        st.domains = upsert(st.domains, c.id, value as Domain | null);
        break;
      case "object":
        st.objects = upsert(st.objects, c.id, value as FinancialObject | null);
        break;
      case "category":
        st.categories = upsert(st.categories, c.id, value as Category | null);
        break;
      case "allocation":
        st.allocations = upsert(st.allocations, c.id, value as Allocation | null);
        break;
      case "goal":
        st.goals = upsert(st.goals, c.id, value as Goal | null);
        break;
      case "budget":
        st.budgets = upsert(st.budgets, c.id, value as Budget | null);
        break;
      case "transaction":
        st.transactions = upsert(st.transactions, c.id, value as Transaction | null);
        break;
      case "fx":
        st.fx = st.fx.filter((x) => x.base !== c.id);
        if (value) st.fx.push(value as FxRate);
        break;
      case "settings":
        if (value) doc.settings[WORKSPACE_SETTINGS_KEY] = value;
        break;
      case "currencies":
        if (value) st.currencies = value as CurrencyCode[];
        break;
    }
    result.applied++;
  }
  // Another device may have deleted an account (or goal, category, ...) that an
  // entry here still points at. Mirrors sanitize_ledger in db.rs.
  if (result.applied > 0) doc.ledger = sanitizeLedger(doc.ledger);
  return { doc, result };
}

export type WebBackend = LedgerBackend & {
  /** Subscribe to changes made by ANOTHER tab of the app. */
  onExternalChange(l: () => void): () => void;
};

/**
 * `name` selects the IndexedDB database. The app uses one; tests create
 * several to simulate separate devices.
 */
export function createWebBackend(name = "ledgerone"): WebBackend {
  const store: UseStore = createStore(name, "kv");
  const kv = () => store;

  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | undefined;
  const chan = (): BroadcastChannel | undefined => {
    if (channel || typeof BroadcastChannel === "undefined") return channel;
    channel = new BroadcastChannel(`${name}-db`);
    channel.onmessage = () => listeners.forEach((l) => l());
    return channel;
  };

  async function mutate(fn: (d: Doc) => Doc): Promise<void> {
    await update<Doc>(DOC_KEY, (cur) => fn(structuredClone(cur ?? blank())), kv());
    chan()?.postMessage("changed");
  }

  return {
    onExternalChange(l) {
      chan();
      listeners.add(l);
      return () => listeners.delete(l);
    },

    async getSetting(key) {
      const doc = await get<Doc>(DOC_KEY, kv());
      const v = doc?.settings[key];
      return v === undefined ? null : v;
    },

    async setSetting(key, value) {
      await mutate((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
    },

    async selectLedgerState() {
      const doc = (await get<Doc>(DOC_KEY, kv())) ?? blank();
      const l = doc.ledger;
      return {
        currencies: [...l.currencies].sort(cmp),
        fx: l.fx,
        domains: [...l.domains].sort((a, b) => cmp(a.name, b.name)),
        objects: [...l.objects].sort((a, b) => cmp(a.name, b.name)),
        categories: [...l.categories].sort((a, b) => cmp(a.name, b.name)),
        allocations: [...l.allocations].sort((a, b) => cmp(a.name, b.name)),
        goals: [...l.goals].sort((a, b) => cmp(a.deadline, b.deadline)),
        budgets: [...l.budgets].sort((a, b) => cmp(b.month, a.month)),
        transactions: [...l.transactions].sort((a, b) => cmp(b.date, a.date) || cmp(b.id, a.id)),
        settings: doc.settings[WORKSPACE_SETTINGS_KEY] as WorkspaceSettings | undefined,
      };
    },

    async insertDomain(d) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, domains: addUnique(doc.ledger.domains, d, "domain") },
      }));
    },
    async updateDomain(id, patch) {
      await mutate((doc) => {
        const domains = doc.ledger.domains.map((d) => {
          if (d.id !== id) return d;
          const next: Domain = { ...d };
          if (patch.name !== undefined) next.name = patch.name;
          if (patch.kind !== undefined) next.kind = patch.kind;
          // "key present" means set it, "present but undefined" means clear it.
          if ("displayCurrency" in patch) {
            if (patch.displayCurrency === undefined) delete next.displayCurrency;
            else next.displayCurrency = patch.displayCurrency;
          }
          if ("description" in patch) {
            if (patch.description === undefined) delete next.description;
            else next.description = patch.description;
          }
          return next;
        });
        return { ...doc, ledger: { ...doc.ledger, domains } };
      });
    },
    async deleteDomain(id) {
      await mutate((doc) => ({ ...doc, ledger: deleteDomainFromState(doc.ledger, id) }));
    },

    async insertObject(o) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, objects: addUnique(doc.ledger.objects, o, "account") },
      }));
    },
    async updateObject(id, patch) {
      await mutate((doc) => ({
        ...doc,
        ledger: {
          ...doc.ledger,
          objects: doc.ledger.objects.map((o) =>
            o.id === id ? applyPatch(o, patch, CLEARABLE.object) : o,
          ),
        },
      }));
    },
    async deleteObject(id) {
      await mutate((doc) => ({ ...doc, ledger: deleteObjectFromState(doc.ledger, id) }));
    },

    async insertAllocation(a) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, allocations: addUnique(doc.ledger.allocations, a, "allocation") },
      }));
    },
    async insertGoal(g) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, goals: addUnique(doc.ledger.goals, g, "goal") },
      }));
    },
    async insertBudget(b) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, budgets: addUnique(doc.ledger.budgets, b, "budget") },
      }));
    },
    async insertCategory(c) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, categories: addUnique(doc.ledger.categories, c, "category") },
      }));
    },

    async updateAllocation(id, patch) {
      await mutate((doc) => ({
        ...doc,
        ledger: {
          ...doc.ledger,
          allocations: doc.ledger.allocations.map((x) =>
            x.id === id ? applyPatch(x, patch, CLEARABLE.allocation) : x,
          ),
        },
      }));
    },
    async deleteAllocation(id) {
      await mutate((doc) => ({ ...doc, ledger: deleteAllocationFromState(doc.ledger, id) }));
    },
    async updateGoal(id, patch) {
      await mutate((doc) => ({
        ...doc,
        ledger: {
          ...doc.ledger,
          goals: doc.ledger.goals.map((x) =>
            x.id === id ? applyPatch(x, patch, CLEARABLE.goal) : x,
          ),
        },
      }));
    },
    async deleteGoal(id) {
      await mutate((doc) => ({ ...doc, ledger: deleteGoalFromState(doc.ledger, id) }));
    },
    async updateBudget(b) {
      await mutate((doc) => ({
        ...doc,
        ledger: {
          ...doc.ledger,
          budgets: doc.ledger.budgets.map((x) =>
            x.id === b.id ? { ...x, currency: b.currency, lines: b.lines } : x,
          ),
        },
      }));
    },
    async deleteBudget(id) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, budgets: doc.ledger.budgets.filter((b) => b.id !== id) },
      }));
    },
    async updateCategory(id, patch) {
      await mutate((doc) => ({
        ...doc,
        ledger: {
          ...doc.ledger,
          categories: doc.ledger.categories.map((x) =>
            x.id === id ? applyPatch(x, patch, CLEARABLE.category) : x,
          ),
        },
      }));
    },
    async deleteCategory(id, reassignTo) {
      await mutate((doc) => ({
        ...doc,
        ledger: deleteCategoryFromState(doc.ledger, id, reassignTo),
      }));
    },

    async insertTransaction(t) {
      await mutate((doc) => ({
        ...doc,
        ledger: {
          ...doc.ledger,
          transactions: addUnique(doc.ledger.transactions, t, "transaction"),
        },
      }));
    },
    async updateTransaction(id, patch) {
      await mutate((doc) => ({
        ...doc,
        ledger: {
          ...doc.ledger,
          transactions: doc.ledger.transactions.map((t) =>
            t.id === id ? applyPatch(t, patch, CLEARABLE.transaction) : t,
          ),
        },
      }));
    },
    async deleteTransaction(id) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, transactions: doc.ledger.transactions.filter((t) => t.id !== id) },
      }));
    },

    async upsertFxRate(fx) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, fx: [...doc.ledger.fx.filter((r) => r.base !== fx.base), fx] },
      }));
    },
    async deleteFxRatesForBase(base) {
      await mutate((doc) => ({
        ...doc,
        ledger: { ...doc.ledger, fx: doc.ledger.fx.filter((r) => r.base !== base) },
      }));
    },
    async setCurrencyEnabled(code, enabled) {
      await mutate((doc) => {
        const has = doc.ledger.currencies.includes(code);
        const currencies =
          enabled && !has
            ? [...doc.ledger.currencies, code]
            : !enabled && has
              ? doc.ledger.currencies.filter((c) => c !== code)
              : doc.ledger.currencies;
        return { ...doc, ledger: { ...doc.ledger, currencies } };
      });
    },
    async saveSettings(s) {
      await mutate((doc) => ({
        ...doc,
        settings: { ...doc.settings, [WORKSPACE_SETTINGS_KEY]: s },
      }));
    },

    async replaceLedger(s) {
      await mutate((doc) => {
        const { settings, ...rest } = s;
        const ledger = sanitizeLedger({ ...rest, settings: undefined } as LedgerState);
        delete (ledger as { settings?: unknown }).settings;
        return {
          ledger,
          settings: settings
            ? { ...doc.settings, [WORKSPACE_SETTINGS_KEY]: settings }
            : doc.settings,
        };
      });
    },
    async resetWorkspace() {
      await mutate((doc) => {
        const settings = { ...doc.settings };
        for (const k of ["security_config", "onboarding_state", "tour_state"]) delete settings[k];
        return { ledger: baseline(), settings };
      });
    },
    async ensureInitialized() {
      let ran = false;
      await mutate((doc) => {
        if (doc.settings.workspace_initialized === true) return doc;
        ran = true;
        // Additive only: data may already be here (e.g. pulled from the cloud
        // before the workspace was first opened).
        const domains = doc.ledger.domains.some((d) => d.id === "personal")
          ? doc.ledger.domains
          : [...doc.ledger.domains, ...baseline().domains];
        return {
          ledger: { ...doc.ledger, domains },
          settings: { ...doc.settings, workspace_initialized: true },
        };
      });
      return ran;
    },

    async applyRemoteChanges(changes) {
      let result: ApplyResult = { applied: 0, skipped: 0 };
      await mutate((doc) => {
        const folded = foldChanges(doc, changes);
        result = folded.result;
        return folded.doc;
      });
      return result;
    },
  };
}

export const webBackend = createWebBackend();

/** Called when ANOTHER tab changed the database. */
export const onExternalDatabaseChange = (l: () => void) => webBackend.onExternalChange(l);

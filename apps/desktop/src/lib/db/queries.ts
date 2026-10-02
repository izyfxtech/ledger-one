// The app talks to the local database only through these functions. Which
// implementation answers depends on where we are running: rusqlite through
// Tauri on desktop, IndexedDB in a browser. See backend.ts.
import { isTauriRuntime, type LedgerBackend } from "./backend";
import { tauriBackend } from "./tauri-backend";
import { webBackend } from "./web-backend";

const backend = (): LedgerBackend => (isTauriRuntime() ? tauriBackend : webBackend);

export const getSetting: LedgerBackend["getSetting"] = (k) => backend().getSetting(k);
export const setSetting: LedgerBackend["setSetting"] = (k, v) => backend().setSetting(k, v);
export const selectLedgerState: LedgerBackend["selectLedgerState"] = () =>
  backend().selectLedgerState();

export const insertDomain: LedgerBackend["insertDomain"] = (d) => backend().insertDomain(d);
export const updateDomain: LedgerBackend["updateDomain"] = (id, p) => backend().updateDomain(id, p);
export const deleteDomain: LedgerBackend["deleteDomain"] = (id) => backend().deleteDomain(id);

export const insertObject: LedgerBackend["insertObject"] = (o) => backend().insertObject(o);
export const updateObject: LedgerBackend["updateObject"] = (id, p) => backend().updateObject(id, p);
export const deleteObject: LedgerBackend["deleteObject"] = (id) => backend().deleteObject(id);

export const insertAllocation: LedgerBackend["insertAllocation"] = (a) =>
  backend().insertAllocation(a);
export const insertGoal: LedgerBackend["insertGoal"] = (g) => backend().insertGoal(g);
export const insertBudget: LedgerBackend["insertBudget"] = (b) => backend().insertBudget(b);
export const insertCategory: LedgerBackend["insertCategory"] = (c) => backend().insertCategory(c);

export const insertTransaction: LedgerBackend["insertTransaction"] = (t) =>
  backend().insertTransaction(t);
export const updateTransaction: LedgerBackend["updateTransaction"] = (id, p) =>
  backend().updateTransaction(id, p);
export const deleteTransaction: LedgerBackend["deleteTransaction"] = (id) =>
  backend().deleteTransaction(id);

export const upsertFxRate: LedgerBackend["upsertFxRate"] = (fx) => backend().upsertFxRate(fx);
export const deleteFxRatesForBase: LedgerBackend["deleteFxRatesForBase"] = (b) =>
  backend().deleteFxRatesForBase(b);
export const setCurrencyEnabled: LedgerBackend["setCurrencyEnabled"] = (c, e) =>
  backend().setCurrencyEnabled(c, e);
export const saveSettings: LedgerBackend["saveSettings"] = (s) => backend().saveSettings(s);

export const replaceLedger: LedgerBackend["replaceLedger"] = (s) => backend().replaceLedger(s);
export const resetWorkspace: LedgerBackend["resetWorkspace"] = () => backend().resetWorkspace();
export const ensureInitialized: LedgerBackend["ensureInitialized"] = () =>
  backend().ensureInitialized();
export const applyRemoteChanges: LedgerBackend["applyRemoteChanges"] = (c) =>
  backend().applyRemoteChanges(c);

export const updateAllocation: LedgerBackend["updateAllocation"] = (id, p) =>
  backend().updateAllocation(id, p);
export const deleteAllocation: LedgerBackend["deleteAllocation"] = (id) =>
  backend().deleteAllocation(id);
export const updateGoal: LedgerBackend["updateGoal"] = (id, p) => backend().updateGoal(id, p);
export const deleteGoal: LedgerBackend["deleteGoal"] = (id) => backend().deleteGoal(id);
export const updateBudget: LedgerBackend["updateBudget"] = (b) => backend().updateBudget(b);
export const deleteBudget: LedgerBackend["deleteBudget"] = (id) => backend().deleteBudget(id);
export const updateCategory: LedgerBackend["updateCategory"] = (id, p) =>
  backend().updateCategory(id, p);
export const deleteCategory: LedgerBackend["deleteCategory"] = (id, to) =>
  backend().deleteCategory(id, to);

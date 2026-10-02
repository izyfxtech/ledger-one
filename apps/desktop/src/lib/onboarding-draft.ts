import { createStore } from "@tanstack/react-store";
import { loadDisplayName } from "@/lib/local-store";
import type { CurrencyCode, ObjectKind } from "@/lib/ledger/types";

// Wizard draft as a TanStack Store instead of six useState hooks in one
// 130-line component. Setters accept a value or an updater, like useState's,
// so step bodies didn't need rewriting.

export type DraftAccount = {
  name: string;
  kind: ObjectKind;
  currency: CurrencyCode;
  balance: string;
  institution?: string;
};

export type DraftCategory = { name: string; type: "income" | "expense"; enabled: boolean };
export type DraftGroup = { id: string; label: string; hint: string; categories: DraftCategory[] };

type Draft = {
  step: number;
  displayName: string;
  defaultCurrency: CurrencyCode;
  enabledCurrencies: CurrencyCode[];
  groups: DraftGroup[];
  accounts: DraftAccount[];
};

type Next<T> = T | ((prev: T) => T);

export const draftStore = createStore<Draft>({
  step: 0,
  displayName: "",
  defaultCurrency: "USD",
  enabledCurrencies: ["USD"],
  groups: [],
  accounts: [],
});

/** Reset for a fresh run. Called from the onboarding route's loader, so every
 *  visit starts clean without a mount effect. */
export function resetDraft(groups: DraftGroup[]) {
  draftStore.setState(() => ({
    step: 0,
    displayName: loadDisplayName(),
    defaultCurrency: "USD",
    enabledCurrencies: ["USD"],
    // deep clone so edits never leak into the module-level defaults
    groups: groups.map((g) => ({ ...g, categories: g.categories.map((c) => ({ ...c })) })),
    accounts: [],
  }));
}

function setter<K extends keyof Draft>(key: K) {
  return (next: Next<Draft[K]>) =>
    draftStore.setState((s) => ({
      ...s,
      [key]: typeof next === "function" ? (next as (p: Draft[K]) => Draft[K])(s[key]) : next,
    }));
}

export const draft = {
  setStep: setter("step"),
  setDisplayName: setter("displayName"),
  setDefaultCurrency: setter("defaultCurrency"),
  setEnabledCurrencies: setter("enabledCurrencies"),
  setGroups: setter("groups"),
  setAccounts: setter("accounts"),
};

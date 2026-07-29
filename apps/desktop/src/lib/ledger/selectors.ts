import type { CurrencyCode, FinancialObject, LedgerState, Transaction } from "./types";

/** Reporting currency for the whole workspace: user setting, else USD. */
export function workspaceDisplayCurrency(state: LedgerState): CurrencyCode {
  return state.settings?.defaultCurrency ?? "USD";
}

/** Reporting currency for a domain: its override, else workspace default, else USD. */
export function domainDisplayCurrency(state: LedgerState, domainId: string): CurrencyCode {
  const d = state.domains.find((x) => x.id === domainId);
  return d?.displayCurrency ?? workspaceDisplayCurrency(state);
}

export const isLiability = (o: FinancialObject) =>
  o.kind === "loan" || o.kind === "mortgage" || o.kind === "credit_card";

export const isAsset = (o: FinancialObject) => !isLiability(o);

export const isLiquid = (o: FinancialObject) =>
  o.kind === "account" || o.kind === "cash" || o.kind === "wallet";

/** A void transaction is kept in the ledger (and stays visible in
 *  transaction lists, for an audit trail) but never contributes to any
 *  balance, total, or aggregate — see the `transactions.status` comment
 *  in packages/db/src/schema.ts. Every selector below that sums entries
 *  needs to skip these; `transactionsByDomain`/`transactionsForObject`
 *  deliberately do NOT, since those power list views, not totals. */
export const isVoid = (t: Transaction) => t.status === "void";

export function balanceOf(state: LedgerState, objectId: string): number {
  let sum = 0;
  for (const t of state.transactions) {
    if (isVoid(t)) continue;
    for (const e of t.entries) {
      if (e.objectId === objectId) sum += e.amount;
    }
  }
  return sum;
}

const warnedPairs = new Set<string>();
function warnMissingRate(from: CurrencyCode, to: CurrencyCode) {
  const key = `${from}->${to}`;
  if (warnedPairs.has(key)) return;
  warnedPairs.add(key);
  if (typeof console !== "undefined") {
    console.warn(`[ledger] Missing FX rate for ${key}; treating amount as ${to}. Add an FX row to state.fx.`);
  }
}

/**
 * Rate of 1 unit of `code` in USD. USD is the anchor currency and is
 * always exactly 1 by definition — it doesn't depend on a stored fx row,
 * unlike every other currency. (Previously this relied on a `{base:
 * "USD", rate: 1}` row existing in state.fx; deleting that row via
 * Settings → Exchange rates silently broke every conversion in the app.)
 */
function usdRateOf(state: LedgerState, code: CurrencyCode): number | null {
  if (code === "USD") return 1;
  const row = state.fx.find((f) => f.base === code);
  return row ? row.rate : null;
}

export function convert(
  state: LedgerState,
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode = "USD",
): number {
  if (from === to) return amount;
  const fromRate = usdRateOf(state, from);
  const toRate = usdRateOf(state, to);
  if (fromRate == null || toRate == null || toRate === 0) {
    warnMissingRate(from, to);
    return amount;
  }
  const inUsd = amount * fromRate;
  return inUsd / toRate;
}

export function objectsByDomain(state: LedgerState, domainId: string) {
  return state.objects.filter((o) => o.domainId === domainId);
}

export function domainMetrics(state: LedgerState, domainId: string) {
  const objs = objectsByDomain(state, domainId);
  let assets = 0, liabilities = 0, liquid = 0;
  for (const o of objs) {
    const b = balanceOf(state, o.id);
    const usd = convert(state, b, o.currency, "USD");
    if (isLiability(o)) liabilities += usd;
    else {
      assets += usd;
      if (isLiquid(o)) liquid += usd;
    }
  }
  return { assets, liabilities, netWorth: assets - liabilities, liquid };
}

export function workspaceMetrics(state: LedgerState) {
  let assets = 0, liabilities = 0, liquid = 0;
  for (const o of state.objects) {
    const b = balanceOf(state, o.id);
    const usd = convert(state, b, o.currency, "USD");
    if (isLiability(o)) liabilities += usd;
    else {
      assets += usd;
      if (isLiquid(o)) liquid += usd;
    }
  }
  const businesses = state.domains.filter((d) => d.kind === "business" || d.kind === "trading").length;
  const allocated = state.allocations.reduce((acc, a) => {
    // sum entries flagged with this allocationId, converted to USD
    let sum = 0;
    for (const t of state.transactions)
      for (const e of t.entries)
        if (e.allocationId === a.id) {
          const obj = state.objects.find((o) => o.id === e.objectId);
          if (obj) sum += convert(state, e.amount, obj.currency, "USD");
        }
    return acc + Math.max(0, sum);
  }, 0);
  return {
    assets,
    liabilities,
    netWorth: assets - liabilities,
    liquid,
    cashAvailable: liquid - allocated,
    businesses,
  };
}

export function allocationBalance(state: LedgerState, allocationId: string): number {
  // Total in USD across entries flagged to this allocation
  let usd = 0;
  for (const t of state.transactions) {
    if (isVoid(t)) continue;
    for (const e of t.entries)
      if (e.allocationId === allocationId) {
        const obj = state.objects.find((o) => o.id === e.objectId);
        if (obj) usd += convert(state, e.amount, obj.currency, "USD");
      }
  }
  return usd;
}

export function allocationByAccount(state: LedgerState, allocationId: string) {
  const map = new Map<string, number>();
  for (const t of state.transactions) {
    if (isVoid(t)) continue;
    for (const e of t.entries)
      if (e.allocationId === allocationId) {
        map.set(e.objectId, (map.get(e.objectId) ?? 0) + e.amount);
      }
  }
  return Array.from(map.entries()).map(([objectId, amount]) => ({
    objectId,
    amount,
  }));
}

export function goalProgress(state: LedgerState, goalId: string) {
  const g = state.goals.find((x) => x.id === goalId);
  if (!g) return { current: 0, pct: 0 };
  let currentUsd = 0;
  for (const t of state.transactions) {
    if (isVoid(t)) continue;
    for (const e of t.entries)
      if (e.goalId === goalId || (g.linkedAllocationId && e.allocationId === g.linkedAllocationId)) {
        const obj = state.objects.find((o) => o.id === e.objectId);
        if (obj) currentUsd += convert(state, Math.abs(e.amount), obj.currency, "USD");
      }
  }
  const targetUsd = convert(state, g.target, g.currency, "USD");
  return { current: currentUsd, pct: targetUsd > 0 ? Math.min(1, currentUsd / targetUsd) : 0 };
}

export function budgetSpent(
  state: LedgerState,
  budgetId: string,
  categoryId: string,
): number {
  const b = state.budgets.find((x) => x.id === budgetId);
  if (!b) return 0;
  const [y, m] = b.month.split("-").map(Number);
  let usd = 0;
  for (const t of state.transactions) {
    if (isVoid(t)) continue;
    const d = new Date(t.date);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m) continue;
    for (const e of t.entries) {
      if (e.categoryId !== categoryId) continue;
      const obj = state.objects.find((o) => o.id === e.objectId);
      if (!obj || obj.domainId !== b.domainId) continue;
      if (e.amount < 0) usd += convert(state, -e.amount, obj.currency, b.currency);
    }
  }
  return usd;
}

/** Deliberately includes void transactions — this powers list views, and
 *  voiding something should leave a visible (styled-differently) record
 *  rather than hide it. Anything computing a total should use one of the
 *  balance/aggregate selectors above instead, which all exclude void. */
export function transactionsByDomain(state: LedgerState, domainId: string): Transaction[] {
  const ids = new Set(objectsByDomain(state, domainId).map((o) => o.id));
  return state.transactions
    .filter((t) => t.entries.some((e) => ids.has(e.objectId)))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Same as transactionsByDomain: deliberately includes void transactions. */
export function transactionsForObject(state: LedgerState, objectId: string): Transaction[] {
  return state.transactions
    .filter((t) => t.entries.some((e) => e.objectId === objectId))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function monthlyCashFlow(state: LedgerState, domainId: string) {
  const ids = new Set(objectsByDomain(state, domainId).filter(isLiquid).map((o) => o.id));
  const buckets = new Map<string, { income: number; expense: number }>();
  for (const t of state.transactions) {
    if (isVoid(t)) continue;
    const d = new Date(t.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const cur = buckets.get(key) ?? { income: 0, expense: 0 };
    for (const e of t.entries) {
      if (!ids.has(e.objectId)) continue;
      const obj = state.objects.find((o) => o.id === e.objectId);
      if (!obj) continue;
      const usd = convert(state, e.amount, obj.currency, "USD");
      if (usd > 0) cur.income += usd;
      else cur.expense += -usd;
    }
    buckets.set(key, cur);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, net: v.income - v.expense }));
}

export function formatMoney(amount: number, currency: CurrencyCode, opts: { signed?: boolean; compact?: boolean } = {}): string {
  const sym: Record<CurrencyCode, string> = { NGN: "₦", USD: "$", GBP: "£", EUR: "€" };
  const abs = Math.abs(amount);
  const digits = currency === "NGN" ? 0 : 2;
  const formatted = opts.compact && abs >= 1000
    ? compactFormat(abs, digits)
    : abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = amount < 0 ? "−" : opts.signed ? "+" : "";
  return `${sign}${sym[currency]}${formatted}`;
}

function compactFormat(n: number, digits: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(digits);
}

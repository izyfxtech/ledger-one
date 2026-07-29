import { describe, expect, it } from "vitest";
import {
  convert,
  balanceOf,
  domainMetrics,
  allocationBalance,
  goalProgress,
  budgetSpent,
  monthlyCashFlow,
  transactionsByDomain,
  transactionsForObject,
} from "@/lib/ledger/selectors";
import type { LedgerState, Transaction } from "@/lib/ledger/types";

function stateWithFx(fx: LedgerState["fx"]): LedgerState {
  return {
    currencies: ["USD", "NGN", "GBP"],
    fx,
    domains: [],
    objects: [],
    categories: [],
    allocations: [],
    goals: [],
    budgets: [],
    transactions: [],
  };
}

describe("convert", () => {
  it("returns the amount unchanged for same-currency conversion", () => {
    const state = stateWithFx([]);
    expect(convert(state, 100, "USD", "USD")).toBe(100);
  });

  it("converts using USD as the anchor even with no stored USD row", () => {
    // Regression: convert() used to require an explicit {base:"USD",
    // rate:1} row in state.fx and silently no-op (returning the raw,
    // unconverted amount) whenever it was missing — e.g. after a user
    // deleted it via Settings > Exchange rates.
    const state = stateWithFx([{ base: "NGN", quote: "USD", rate: 0.00066 }]);
    // 1,000,000 NGN * 0.00066 = 660 USD
    expect(convert(state, 1_000_000, "NGN", "USD")).toBeCloseTo(660, 6);
  });

  it("still works if a USD anchor row happens to be present", () => {
    const state = stateWithFx([
      { base: "USD", quote: "USD", rate: 1 },
      { base: "NGN", quote: "USD", rate: 0.00066 },
    ]);
    expect(convert(state, 1_000_000, "NGN", "USD")).toBeCloseTo(660, 6);
  });

  it("converts between two non-USD currencies via the USD anchor", () => {
    const state = stateWithFx([
      { base: "NGN", quote: "USD", rate: 0.00066 },
      { base: "GBP", quote: "USD", rate: 1.27 },
    ]);
    const usd = 1_000_000 * 0.00066;
    expect(convert(state, 1_000_000, "NGN", "GBP")).toBeCloseTo(usd / 1.27, 6);
  });

  it("falls back to the raw amount and warns when a needed rate is truly missing", () => {
    const state = stateWithFx([]); // no GBP rate at all
    expect(convert(state, 100, "GBP", "USD")).toBe(100);
  });
});

describe("void transactions are excluded from every balance/aggregate selector", () => {
  // A single domain with one liquid checking account, one allocation, one
  // goal linked to that allocation, and a budget line for "groceries" —
  // enough surface area to exercise every selector that sums entries.
  // Two otherwise-identical $100 grocery-expense transactions: one
  // "cleared" (should count everywhere) and one "void" (should count
  // nowhere except the raw list-view selectors, where it should still
  // show up so voiding leaves a visible record).
  function baseState(): LedgerState {
    const clearedTxn: Transaction = {
      id: "tx_cleared",
      date: "2026-03-05",
      description: "Groceries (cleared)",
      kind: "expense",
      status: "cleared",
      entries: [
        { objectId: "obj_checking", amount: -100, categoryId: "cat_groceries", allocationId: "alloc_fun", goalId: "goal_trip" },
      ],
    };
    const voidTxn: Transaction = {
      id: "tx_void",
      date: "2026-03-06",
      description: "Groceries (voided — entered twice by mistake)",
      kind: "expense",
      status: "void",
      entries: [
        { objectId: "obj_checking", amount: -100, categoryId: "cat_groceries", allocationId: "alloc_fun", goalId: "goal_trip" },
      ],
    };
    return {
      currencies: ["USD"],
      fx: [],
      domains: [{ id: "dom_personal", name: "Personal", kind: "personal" }],
      objects: [
        { id: "obj_checking", domainId: "dom_personal", name: "Checking", kind: "account", currency: "USD" },
      ],
      categories: [{ id: "cat_groceries", name: "Groceries", type: "expense" }],
      allocations: [{ id: "alloc_fun", domainId: "dom_personal", name: "Fun money", targetCurrency: "USD" }],
      goals: [{ id: "goal_trip", domainId: "dom_personal", name: "Trip", target: 1000, currency: "USD", deadline: "2027-01-01" }],
      budgets: [
        {
          id: "bud_march",
          domainId: "dom_personal",
          month: "2026-03",
          currency: "USD",
          lines: [{ categoryId: "cat_groceries", amount: 500 }],
        },
      ],
      transactions: [clearedTxn, voidTxn],
    };
  }

  it("balanceOf ignores the void transaction's entries", () => {
    const state = baseState();
    // Only the cleared -100 should land; the void -100 must not.
    expect(balanceOf(state, "obj_checking")).toBe(-100);
  });

  it("domainMetrics (built on balanceOf) reflects only the cleared transaction", () => {
    const state = baseState();
    const m = domainMetrics(state, "dom_personal");
    expect(m.assets).toBe(-100);
    expect(m.liquid).toBe(-100);
  });

  it("allocationBalance excludes the void transaction", () => {
    const state = baseState();
    expect(allocationBalance(state, "alloc_fun")).toBe(-100);
  });

  it("goalProgress excludes the void transaction", () => {
    const state = baseState();
    const { current } = goalProgress(state, "goal_trip");
    // goalProgress sums Math.abs(amount), so 100 (cleared only), not 200.
    expect(current).toBe(100);
  });

  it("budgetSpent excludes the void transaction", () => {
    const state = baseState();
    expect(budgetSpent(state, "bud_march", "cat_groceries")).toBe(100);
  });

  it("monthlyCashFlow excludes the void transaction", () => {
    const state = baseState();
    const months = monthlyCashFlow(state, "dom_personal");
    const march = months.find((m) => m.month === "2026-03")!;
    expect(march.expense).toBe(100); // not 200
  });

  it("transactionsByDomain and transactionsForObject still include the void transaction", () => {
    // These power list/ledger views, not totals — voiding something
    // should leave a visible audit trail, not hide it.
    const state = baseState();
    expect(transactionsByDomain(state, "dom_personal").map((t) => t.id).sort()).toEqual([
      "tx_cleared",
      "tx_void",
    ]);
    expect(transactionsForObject(state, "obj_checking").map((t) => t.id).sort()).toEqual([
      "tx_cleared",
      "tx_void",
    ]);
  });
});

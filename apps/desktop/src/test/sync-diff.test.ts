import { describe, expect, it } from "vitest";
import { diffLedgerState, type DiffAction } from "@/lib/sync/diff";
import type { EntityKind } from "@/lib/sync/types";
import type { LedgerState, CurrencyCode } from "@/lib/ledger/types";

function empty(): LedgerState {
  return {
    currencies: ["USD"],
    fx: [],
    domains: [],
    objects: [],
    categories: [],
    allocations: [],
    goals: [],
    budgets: [],
    transactions: [],
  };
}

function collect(prev: LedgerState, next: LedgerState) {
  const events: { kind: EntityKind; id: string; action: DiffAction }[] = [];
  diffLedgerState(prev, next, (kind, id, action) => events.push({ kind, id, action }));
  return events;
}

describe("diffLedgerState", () => {
  it("reports nothing for two identical (same-reference) states", () => {
    const s = empty();
    expect(collect(s, s)).toEqual([]);
  });

  it("reports an upsert when a new row is added to an id-keyed array", () => {
    const prev = empty();
    const next = { ...prev, domains: [{ id: "dom_1", name: "Personal", kind: "personal" as const }] };
    expect(collect(prev, next)).toEqual([{ kind: "domain", id: "dom_1", action: "upsert" }]);
  });

  it("reports an upsert when an existing row's reference changes (an edit)", () => {
    const domain = { id: "dom_1", name: "Personal", kind: "personal" as const };
    const prev = { ...empty(), domains: [domain] };
    const next = { ...prev, domains: [{ ...domain, name: "Personal (renamed)" }] };
    expect(collect(prev, next)).toEqual([{ kind: "domain", id: "dom_1", action: "upsert" }]);
  });

  it("reports nothing when a row's reference is unchanged, even alongside other changes elsewhere", () => {
    const domain = { id: "dom_1", name: "Personal", kind: "personal" as const };
    const prev = { ...empty(), domains: [domain] };
    // Same array of domains (same object reference for the row), but a
    // transaction was added elsewhere — only the transaction should fire.
    const next = {
      ...prev,
      transactions: [{ id: "tx_1", date: "2026-01-01", description: "x", kind: "expense" as const, entries: [] }],
    };
    expect(collect(prev, next)).toEqual([{ kind: "transaction", id: "tx_1", action: "upsert" }]);
  });

  it("reports a delete when a row disappears from an id-keyed array", () => {
    const domain = { id: "dom_1", name: "Personal", kind: "personal" as const };
    const prev = { ...empty(), domains: [domain] };
    const next = { ...prev, domains: [] };
    expect(collect(prev, next)).toEqual([{ kind: "domain", id: "dom_1", action: "delete" }]);
  });

  it("diffs fx by `base`, not `id` (FxRate has no id field)", () => {
    const prev = { ...empty(), fx: [{ base: "NGN" as const, quote: "USD" as const, rate: 0.00066 }] };
    const next = {
      ...prev,
      fx: [
        { base: "NGN" as const, quote: "USD" as const, rate: 0.00066 }, // same values, but check by reference below
        { base: "GBP" as const, quote: "USD" as const, rate: 1.27 },
      ],
    };
    // The NGN row is a *new* object here even though values match, so by
    // the reference-identity rule it correctly reports as an upsert too —
    // diff only promises "no false negatives", not deep-equality dedupe.
    const events = collect(prev, next);
    expect(events).toContainEqual({ kind: "fx", id: "GBP", action: "upsert" });
    expect(events).toContainEqual({ kind: "fx", id: "NGN", action: "upsert" });
  });

  it("reports fx deletion by base when a rate is removed", () => {
    const rate = { base: "NGN" as const, quote: "USD" as const, rate: 0.00066 };
    const prev = { ...empty(), fx: [rate] };
    const next = { ...prev, fx: [] };
    expect(collect(prev, next)).toEqual([{ kind: "fx", id: "NGN", action: "delete" }]);
  });

  it("reports settings as a single upsert (never a delete) when its reference changes", () => {
    const prev = empty();
    const next = {
      ...prev,
      settings: {
        workspaceName: "Mine",
        defaultCurrency: "USD" as const,
        fiscalYearStart: "January" as const,
        timezone: "UTC",
        theme: "light" as const,
        density: "comfortable" as const,
      },
    };
    expect(collect(prev, next)).toEqual([{ kind: "settings", id: "_", action: "upsert" }]);
  });

  it("reports currencies as a single upsert when the array reference changes", () => {
    const prev = empty();
    const next = { ...prev, currencies: ["USD", "GBP"] as CurrencyCode[] };
    expect(collect(prev, next)).toEqual([{ kind: "currencies", id: "_", action: "upsert" }]);
  });

  it("handles a mixed batch of changes across several kinds in one diff", () => {
    const keptDomain = { id: "dom_1", name: "Personal", kind: "personal" as const };
    const deletedGoal = { id: "goal_1", domainId: "dom_1", name: "Trip", target: 1000, currency: "USD" as const, deadline: "2027-01-01" };
    const prev = { ...empty(), domains: [keptDomain], goals: [deletedGoal] };
    const next = {
      ...prev,
      goals: [],
      transactions: [{ id: "tx_1", date: "2026-01-01", description: "x", kind: "expense" as const, entries: [] }],
    };
    const events = collect(prev, next);
    expect(events).toContainEqual({ kind: "goal", id: "goal_1", action: "delete" });
    expect(events).toContainEqual({ kind: "transaction", id: "tx_1", action: "upsert" });
    expect(events).not.toContainEqual(expect.objectContaining({ kind: "domain" }));
  });
});

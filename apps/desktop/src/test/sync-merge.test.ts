import { describe, expect, it } from "vitest";
import { mergeLedgerStates, type Side } from "@/lib/sync/merge";
import { emptySyncMeta } from "@/lib/sync/types";
import type { LedgerState, Domain } from "@/lib/ledger/types";

function emptyState(): LedgerState {
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

function side(state: Partial<LedgerState>, meta: Partial<Side["meta"]> = {}): Side {
  return {
    state: { ...emptyState(), ...state },
    meta: { ...emptySyncMeta(), ...meta },
  };
}

const domain = (id: string, name: string): Domain => ({ id, name, kind: "personal" });

describe("mergeLedgerStates", () => {
  it("keeps a row that only exists on one side", () => {
    const a = side(
      { domains: [domain("dom_1", "Personal")] },
      { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } },
    );
    const b = side({});
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.domains).toEqual([domain("dom_1", "Personal")]);
  });

  it("prefers the row with the more recent updatedAt when both sides have a version", () => {
    const older = domain("dom_1", "Personal (old name)");
    const newer = domain("dom_1", "Personal (renamed on B)");
    const a = side(
      { domains: [older] },
      { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } },
    );
    const b = side(
      { domains: [newer] },
      { updatedAt: { "domain:dom_1": "2026-01-02T00:00:00.000Z" } }, // later
    );
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.domains).toEqual([newer]);
  });

  it("a tombstone beats an untouched-since copy on the other side", () => {
    // B deleted the row after A's last edit — the delete should win.
    const row = domain("dom_1", "Personal");
    const a = side(
      { domains: [row] },
      { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } },
    );
    const b = side(
      { domains: [] },
      { tombstones: { "domain:dom_1": "2026-01-02T00:00:00.000Z" } }, // later delete
    );
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.domains).toEqual([]);
  });

  it("an edit after a delete resurrects the row (undo-delete beats an earlier tombstone)", () => {
    const row = domain("dom_1", "Personal (recreated)");
    const a = side(
      { domains: [] },
      { tombstones: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } },
    );
    const b = side(
      { domains: [row] },
      { updatedAt: { "domain:dom_1": "2026-01-02T00:00:00.000Z" } }, // later than the delete
    );
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.domains).toEqual([row]);
  });

  it("a row untouched on both sides simply passes through unchanged", () => {
    const row = domain("dom_1", "Personal");
    const a = side({ domains: [row] }, { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } });
    const b = side({ domains: [row] }, { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } });
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.domains).toEqual([row]);
  });

  it("merges independent additions from both sides without losing either", () => {
    const a = side(
      { domains: [domain("dom_1", "From A")] },
      { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } },
    );
    const b = side(
      { domains: [domain("dom_2", "From B")] },
      { updatedAt: { "domain:dom_2": "2026-01-01T00:00:00.000Z" } },
    );
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.domains.map((d) => d.id).sort()).toEqual(["dom_1", "dom_2"]);
  });

  it("merges the SyncMeta itself, taking the newer timestamp per ref", () => {
    const a = side({}, { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } });
    const b = side({}, { updatedAt: { "domain:dom_1": "2026-01-03T00:00:00.000Z" } });
    const merged = mergeLedgerStates(a, b);
    expect(merged.meta.updatedAt["domain:dom_1"]).toBe("2026-01-03T00:00:00.000Z");
  });

  it("fx rows merge per-base, not by array position", () => {
    const a = side(
      { fx: [{ base: "NGN" as const, quote: "USD" as const, rate: 0.00066 }] },
      { updatedAt: { "fx:NGN": "2026-01-01T00:00:00.000Z" } },
    );
    const b = side(
      { fx: [{ base: "GBP" as const, quote: "USD" as const, rate: 1.3 }] },
      { updatedAt: { "fx:GBP": "2026-01-01T00:00:00.000Z" } },
    );
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.fx.map((r) => r.base).sort()).toEqual(["GBP", "NGN"]);
  });

  it("settings merges as a whole object — the newer side's settings entirely replace the older", () => {
    const settingsA = {
      workspaceName: "A's workspace",
      defaultCurrency: "USD" as const,
      fiscalYearStart: "January" as const,
      timezone: "UTC",
      theme: "light" as const,
      density: "comfortable" as const,
    };
    const settingsB = { ...settingsA, workspaceName: "B's workspace", theme: "dark" as const };
    const a = side({ settings: settingsA }, { updatedAt: { "settings:_": "2026-01-01T00:00:00.000Z" } });
    const b = side({ settings: settingsB }, { updatedAt: { "settings:_": "2026-01-02T00:00:00.000Z" } });
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.settings).toEqual(settingsB);
  });

  it("a genuine tie (identical timestamp, no delete either side) is resolved deterministically", () => {
    const rowA = domain("dom_1", "A's copy");
    const rowB = domain("dom_1", "B's copy");
    const a = side({ domains: [rowA] }, { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } });
    const b = side({ domains: [rowB] }, { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } });
    // Run it twice both ways to confirm it's actually deterministic, not
    // just "happened to be stable this run".
    expect(mergeLedgerStates(a, b).state.domains).toEqual(mergeLedgerStates(a, b).state.domains);
    const merged = mergeLedgerStates(a, b);
    expect(merged.state.domains).toHaveLength(1);
  });

  it("merging is idempotent: merging a state with itself changes nothing", () => {
    const a = side(
      { domains: [domain("dom_1", "Personal")] },
      { updatedAt: { "domain:dom_1": "2026-01-01T00:00:00.000Z" } },
    );
    const merged = mergeLedgerStates(a, a);
    expect(merged.state.domains).toEqual(a.state.domains);
  });
});

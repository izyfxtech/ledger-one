import { describe, expect, it } from "vitest";
import { domainMetrics, workspaceMetrics } from "@/lib/ledger/selectors";
import type { LedgerState } from "@/lib/ledger/types";

const base = (): LedgerState => ({
  currencies: ["USD"],
  fx: [],
  domains: [{ id: "personal", name: "Personal", kind: "personal" }],
  objects: [
    { id: "chk", domainId: "personal", name: "Checking", kind: "account", currency: "USD" },
    { id: "cc", domainId: "personal", name: "Card", kind: "credit_card", currency: "USD" },
  ],
  categories: [],
  allocations: [{ id: "alc", domainId: "personal", name: "Rainy day", targetCurrency: "USD" }],
  goals: [],
  budgets: [],
  transactions: [],
});

describe("liability sign convention (negative balance = owed)", () => {
  it("owing money on a card lowers net worth and reports liabilities as a positive amount", () => {
    const s = base();
    s.transactions = [
      {
        id: "t1",
        date: "2026-09-01",
        description: "salary",
        kind: "income",
        entries: [{ objectId: "chk", amount: 1000 }],
      },
      {
        id: "t2",
        date: "2026-09-02",
        description: "card spend",
        kind: "expense",
        entries: [{ objectId: "cc", amount: -300 }],
      },
    ];
    const m = domainMetrics(s, "personal");
    expect(m.assets).toBe(1000);
    expect(m.liabilities).toBe(300);
    expect(m.netWorth).toBe(700);
    expect(workspaceMetrics(s).netWorth).toBe(700);
  });
});

describe("void transactions and allocations", () => {
  it("a voided allocation entry no longer reduces cashAvailable", () => {
    const s = base();
    s.transactions = [
      {
        id: "t1",
        date: "2026-09-01",
        description: "salary",
        kind: "income",
        entries: [{ objectId: "chk", amount: 1000 }],
      },
      {
        id: "t2",
        date: "2026-09-02",
        description: "set aside",
        kind: "transfer",
        status: "void",
        entries: [{ objectId: "chk", amount: 500, allocationId: "alc" }],
      },
    ];
    expect(workspaceMetrics(s).cashAvailable).toBe(1000);
    s.transactions[1].status = "cleared";
    // once it counts, the +500 sits on checking (liquid 1500) and is reserved (500)
    expect(workspaceMetrics(s).cashAvailable).toBe(1000);
  });
});

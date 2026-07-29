import { describe, expect, it } from "vitest";
import { accountsToCsv, transactionsToCsv } from "@/lib/ledger/csv";
import type { LedgerState } from "@/lib/ledger/types";

const STATE: LedgerState = {
  currencies: ["USD"],
  fx: [],
  domains: [{ id: "dom_p", name: "Personal", kind: "personal" }],
  objects: [
    { id: "obj_wallet", domainId: "dom_p", name: "Wallet", kind: "cash", currency: "USD" },
  ],
  categories: [{ id: "cat_food", name: "Food, Drink", type: "expense" }],
  allocations: [],
  goals: [],
  budgets: [],
  transactions: [
    {
      id: "tx1",
      date: "2025-01-15",
      description: 'Lunch "downtown"',
      kind: "expense",
      status: "cleared",
      entries: [{ objectId: "obj_wallet", amount: -12.5, categoryId: "cat_food" }],
    },
  ],
};

describe("csv export", () => {
  it("transactionsToCsv includes a header row, resolved names, and a UTF-8 BOM", () => {
    const csv = transactionsToCsv(STATE);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Date,Description,Kind,Status,Domain,Account,Category,Amount,Currency,Notes");
    expect(lines[1]).toContain("Personal");
    expect(lines[1]).toContain("Wallet");
    expect(lines[1]).toContain("-12.5");
  });

  it("quotes and escapes fields containing commas or quotes", () => {
    const csv = transactionsToCsv(STATE);
    // 'Lunch "downtown"' has a comma-free but quote-containing description;
    // 'Food, Drink' (category) has a comma — both must round-trip safely.
    expect(csv).toContain('"Lunch ""downtown"""');
    expect(csv).toContain('"Food, Drink"');
  });

  it("accountsToCsv reports the correct running balance", () => {
    const csv = accountsToCsv(STATE);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Domain,Account,Kind,Institution,Currency,Balance");
    expect(lines[1]).toBe("Personal,Wallet,cash,,USD,-12.5");
  });
});

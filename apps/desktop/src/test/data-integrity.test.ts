import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createWebBackend } from "@/lib/db/web-backend";
import {
  DETACH_NOTE,
  applyPatch,
  CLEARABLE,
  deleteAllocationFromState,
  deleteCategoryFromState,
  deleteDomainFromState,
  deleteGoalFromState,
  deleteObjectFromState,
  sanitizeLedger,
} from "@/lib/ledger/mutations";
import {
  balanceOf,
  budgetSpent,
  goalProgress,
  monthlyCashFlow,
  missingFxBases,
} from "@/lib/ledger";
import type { LedgerState, Transaction } from "@/lib/ledger/types";

const base = (): LedgerState => ({
  currencies: ["USD"],
  fx: [],
  domains: [
    { id: "personal", name: "Personal", kind: "personal" },
    { id: "biz", name: "Biz", kind: "business" },
  ],
  objects: [
    {
      id: "a",
      domainId: "personal",
      name: "A",
      kind: "account",
      currency: "USD",
      creditLimit: 500,
      institution: "Bank",
      dueDay: 5,
    },
    { id: "b", domainId: "biz", name: "B", kind: "account", currency: "USD" },
    { id: "sav", domainId: "personal", name: "Savings", kind: "account", currency: "USD" },
  ],
  categories: [
    { id: "food", name: "Food", type: "expense" },
    { id: "dining", name: "Dining", type: "expense", parentId: "food" },
  ],
  allocations: [{ id: "al", domainId: "personal", name: "Rainy", targetCurrency: "USD" }],
  goals: [
    {
      id: "g",
      domainId: "personal",
      name: "Car",
      target: 1000,
      currency: "USD",
      deadline: "2027-01-01",
      linkedAllocationId: "al",
    },
  ],
  budgets: [
    {
      id: "b1",
      domainId: "personal",
      month: "2026-09",
      currency: "USD",
      lines: [
        { categoryId: "food", amount: 100 },
        { categoryId: "dining", amount: 20 },
      ],
    },
  ],
  transactions: [],
});
const tx = (
  id: string,
  kind: Transaction["kind"],
  entries: Transaction["entries"],
  extra: Partial<Transaction> = {},
): Transaction => ({
  id,
  date: "2026-09-10",
  description: id,
  kind,
  entries,
  ...extra,
});

describe("deleting an account (shared rule: pure state, web backend, and Rust agree)", () => {
  it("deletes tx only on it, voids transfers with a note, leaves unrelated rows alone", () => {
    const s = base();
    s.transactions = [
      tx("xfer", "transfer", [
        { objectId: "a", amount: -100 },
        { objectId: "b", amount: 100 },
      ]),
      tx("solo", "income", [{ objectId: "a", amount: 50 }]),
      tx("other", "income", [{ objectId: "b", amount: 7 }]),
    ];
    const out = deleteObjectFromState(s, "a");
    expect(out.transactions.map((t) => t.id).sort()).toEqual(["other", "xfer"]);
    const x = out.transactions.find((t) => t.id === "xfer")!;
    expect(x.status).toBe("void");
    expect(x.notes).toBe(DETACH_NOTE);
    expect(x.entries).toEqual([{ objectId: "b", amount: 100 }]);
    expect(balanceOf(out, "b")).toBe(7); // the void leg no longer counts toward the survivor
  });

  it("deleting a domain clears tags that pointed at its goals/allocations", () => {
    const s = base();
    s.transactions = [
      tx("t", "income", [{ objectId: "b", amount: 5, goalId: "g", allocationId: "al" }]),
    ];
    const out = deleteDomainFromState(s, "personal");
    expect(out.goals).toEqual([]);
    expect(out.transactions[0].entries[0]).toMatchObject({
      goalId: undefined,
      allocationId: undefined,
    });
  });

  it("goal / allocation / category deletes leave no dangling tags; category delete can merge", () => {
    const s = base();
    s.transactions = [
      tx("t", "expense", [
        { objectId: "a", amount: -10, categoryId: "dining", goalId: "g", allocationId: "al" },
      ]),
    ];
    const merged = deleteCategoryFromState(s, "dining", "food");
    expect(merged.transactions[0].entries[0].categoryId).toBe("food");
    expect(merged.budgets[0].lines).toEqual([{ categoryId: "food", amount: 120 }]);
    expect(deleteGoalFromState(s, "g").transactions[0].entries[0].goalId).toBeUndefined();
    const noAlloc = deleteAllocationFromState(s, "al");
    expect(noAlloc.transactions[0].entries[0].allocationId).toBeUndefined();
    expect(noAlloc.goals[0].linkedAllocationId).toBeUndefined();
  });
});

describe("sanitizeLedger (remote deletions / imports must not leave dangling references)", () => {
  it("drops entries on missing accounts, voids one-sided transfers, clears dead tags", () => {
    const s = base();
    s.transactions = [
      tx("ghost", "expense", [{ objectId: "gone", amount: -1 }]),
      tx("half", "transfer", [
        { objectId: "gone", amount: -5 },
        { objectId: "b", amount: 5 },
      ]),
      tx("tagged", "expense", [
        { objectId: "a", amount: -2, categoryId: "nope", goalId: "nope", allocationId: "nope" },
      ]),
    ];
    const out = sanitizeLedger(s);
    expect(out.transactions.map((t) => t.id).sort()).toEqual(["half", "tagged"]);
    expect(out.transactions.find((t) => t.id === "half")!.status).toBe("void");
    expect(out.transactions.find((t) => t.id === "tagged")!.entries[0]).toMatchObject({
      categoryId: undefined,
      goalId: undefined,
      allocationId: undefined,
    });
  });
});

describe("sanitizeLedger keeps data whose built-in workspace has not been created yet", () => {
  it("recreates the personal domain instead of discarding the account and its transactions", () => {
    const s = base();
    s.domains = []; // fresh device: cloud data arrived before first-run setup
    s.transactions = [tx("salary", "income", [{ objectId: "a", amount: 100 }])];
    s.objects = s.objects.filter((o) => o.domainId === "personal");
    const out = sanitizeLedger(s);
    expect(out.domains.map((d) => d.id)).toEqual(["personal"]);
    expect(out.objects.length).toBe(2);
    expect(out.transactions.length).toBe(1);
  });
  it("still drops things that belong to a deleted business workspace", () => {
    const s = base();
    s.domains = s.domains.filter((d) => d.id !== "biz");
    s.transactions = [tx("t", "income", [{ objectId: "b", amount: 1 }])];
    const out = sanitizeLedger(s);
    expect(out.objects.some((o) => o.id === "b")).toBe(false);
    expect(out.transactions).toEqual([]);
  });
});

describe("patches can clear optional fields", () => {
  it("clears only the clearable keys, and only when the key is present", () => {
    const o = base().objects[0];
    expect(applyPatch(o, { name: "Renamed" }, CLEARABLE.object)).toMatchObject({
      creditLimit: 500,
      institution: "Bank",
    });
    const cleared = applyPatch(
      o,
      { creditLimit: undefined, institution: undefined, dueDay: undefined },
      CLEARABLE.object,
    );
    expect(cleared).not.toHaveProperty("creditLimit");
    expect(cleared).not.toHaveProperty("institution");
    expect(cleared.name).toBe("A");
    // a required field is never cleared by an undefined
    expect(applyPatch(o, { name: undefined }, CLEARABLE.object).name).toBe("A");
  });
});

describe("selectors", () => {
  it("goalProgress is signed: a withdrawal lowers it, never below zero", () => {
    const s = base();
    s.transactions = [
      tx("in", "income", [{ objectId: "sav", amount: 100, goalId: "g" }]),
      tx("out", "expense", [{ objectId: "sav", amount: -100, goalId: "g" }]),
    ];
    expect(goalProgress(s, "g").current).toBe(0);
    s.transactions = [tx("in", "income", [{ objectId: "sav", amount: 100, goalId: "g" }])];
    expect(goalProgress(s, "g").current).toBe(100);
  });

  it("budgetSpent nets refunds and includes sub-categories", () => {
    const s = base();
    s.transactions = [
      tx("lunch", "expense", [{ objectId: "a", amount: -30, categoryId: "dining" }]),
      tx("shop", "expense", [{ objectId: "a", amount: -20, categoryId: "food" }]),
      tx("refund", "income", [{ objectId: "a", amount: 5, categoryId: "food" }]),
    ];
    expect(budgetSpent(s, "b1", "food")).toBe(45); // 30 + 20 - 5, "dining" rolls up into "food"
    expect(budgetSpent(s, "b1", "dining")).toBe(30);
    s.transactions = [tx("r", "income", [{ objectId: "a", amount: 50, categoryId: "food" }])];
    expect(budgetSpent(s, "b1", "food")).toBe(0); // never negative
  });

  it("cash flow ignores transfers, currency exchanges, opening balances and borrowed principal", () => {
    const s = base();
    s.transactions = [
      tx("salary", "income", [{ objectId: "a", amount: 1000 }]),
      tx("move", "transfer", [
        { objectId: "a", amount: -300 },
        { objectId: "sav", amount: 300 },
      ]),
      tx("open", "opening", [{ objectId: "a", amount: 999 }]),
      tx("loan", "loan_disbursement", [{ objectId: "a", amount: 5000 }]),
      tx("rent", "expense", [{ objectId: "a", amount: -400 }]),
    ];
    const [m] = monthlyCashFlow(s, "personal");
    expect(m.income).toBe(1000);
    expect(m.expense).toBe(400);
  });

  it("flags currencies with no exchange rate", () => {
    const s = base();
    s.objects[0].currency = "NGN";
    expect(missingFxBases(s)).toContain("NGN");
    s.fx = [{ base: "NGN", quote: "USD", rate: 0.00065 }];
    expect(missingFxBases(s)).not.toContain("NGN");
  });
});

let n = 0;
let db: ReturnType<typeof createWebBackend>;
beforeEach(async () => {
  db = createWebBackend(`integrity-${++n}-${Math.random()}`);
  await db.ensureInitialized();
});

describe("web backend follows the same rules as the Rust backend", () => {
  it("account delete voids transfers; patches clear fields; new CRUD works", async () => {
    await db.replaceLedger(base());
    await db.insertTransaction(
      tx("xfer", "transfer", [
        { objectId: "a", amount: -100 },
        { objectId: "b", amount: 100 },
      ]),
    );
    await db.updateObject("a", { creditLimit: undefined, institution: undefined });
    let s = await db.selectLedgerState();
    expect(s.objects.find((o) => o.id === "a")).not.toHaveProperty("creditLimit");

    await db.deleteObject("a");
    s = await db.selectLedgerState();
    expect(s.transactions.find((t) => t.id === "xfer")).toMatchObject({
      status: "void",
      notes: DETACH_NOTE,
    });

    await db.updateGoal("g", { name: "Truck", notes: "x" });
    await db.updateGoal("g", { notes: undefined });
    await db.updateBudget({
      id: "b1",
      domainId: "personal",
      month: "2026-09",
      currency: "USD",
      lines: [{ categoryId: "food", amount: 5 }],
    });
    await db.deleteCategory("dining", "food");
    await db.deleteAllocation("al");
    s = await db.selectLedgerState();
    expect(s.goals[0]).toMatchObject({ name: "Truck" });
    expect(s.goals[0]).not.toHaveProperty("notes");
    expect(s.goals[0].linkedAllocationId).toBeUndefined();
    expect(s.budgets[0].lines).toEqual([{ categoryId: "food", amount: 5 }]);
    expect(s.categories.map((c) => c.id)).toEqual(["food"]);
    await db.deleteBudget("b1");
    expect((await db.selectLedgerState()).budgets).toEqual([]);
  });

  it("a remote account deletion cannot leave dangling entries behind", async () => {
    await db.replaceLedger(base());
    await db.insertTransaction(
      tx("xfer", "transfer", [
        { objectId: "a", amount: -1 },
        { objectId: "b", amount: 1 },
      ]),
    );
    await db.insertTransaction(tx("solo", "income", [{ objectId: "a", amount: 3 }]));
    const r = await db.applyRemoteChanges([{ kind: "object", id: "a", deleted: true }]);
    expect(r.applied).toBe(1);
    const s = await db.selectLedgerState();
    expect(s.transactions.map((t) => t.id)).toEqual(["xfer"]);
    expect(s.transactions[0]).toMatchObject({ status: "void" });
  });

  it("import / restore drops references to things that do not exist", async () => {
    const dirty = base();
    dirty.transactions = [
      tx("ghost", "expense", [{ objectId: "nope", amount: -1 }]),
      tx("ok", "income", [{ objectId: "a", amount: 1, categoryId: "missing" }]),
    ];
    await db.replaceLedger(dirty);
    const s = await db.selectLedgerState();
    expect(s.transactions.map((t) => t.id)).toEqual(["ok"]);
    expect(s.transactions[0].entries[0].categoryId).toBeUndefined();
  });
});

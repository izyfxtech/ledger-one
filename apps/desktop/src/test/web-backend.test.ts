import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createWebBackend } from "@/lib/db/web-backend";
import type { Transaction } from "@/lib/ledger/types";

let n = 0;
let db: ReturnType<typeof createWebBackend>;
beforeEach(async () => {
  db = createWebBackend(`test-${++n}-${Math.random()}`);
  await db.ensureInitialized();
});

const obj = (id: string, name: string, domainId = "personal") => ({
  id,
  domainId,
  name,
  kind: "account" as const,
  currency: "USD" as const,
});
const tx = (id: string, date: string, entries: Transaction["entries"]): Transaction => ({
  id,
  date,
  description: id,
  kind: "expense",
  entries,
});

describe("web backend — initial state", () => {
  it("creates only an empty Personal domain, once", async () => {
    const fresh = createWebBackend(`fresh-${Math.random()}`);
    expect(await fresh.ensureInitialized()).toBe(true);
    expect(await fresh.ensureInitialized()).toBe(false);
    const s = await fresh.selectLedgerState();
    expect(s.domains.map((d) => d.id)).toEqual(["personal"]);
    expect(s.objects).toEqual([]);
    expect(s.transactions).toEqual([]);
    expect(s.fx).toEqual([]);
    expect(s.currencies).toEqual([]);
  });
});

describe("web backend — initialisation is additive", () => {
  it("never overwrites data that arrived before the workspace was opened", async () => {
    const fresh = createWebBackend(`pre-${Math.random()}`);
    await fresh.applyRemoteChanges([
      { kind: "domain", id: "personal", data: { id: "personal", name: "Home", kind: "personal" } },
      { kind: "object", id: "o1", data: obj("o1", "Cash") },
    ]);
    expect(await fresh.ensureInitialized()).toBe(true);
    const s = await fresh.selectLedgerState();
    expect(s.objects.map((o) => o.name)).toEqual(["Cash"]);
    expect(s.domains.map((d) => d.name)).toEqual(["Home"]);
  });
});

describe("web backend — behaves like the SQLite backend", () => {
  it("sorts like the SQL queries do", async () => {
    await db.insertObject(obj("o2", "Zeta"));
    await db.insertObject(obj("o1", "Alpha"));
    await db.insertTransaction(tx("t1", "2026-01-01", [{ objectId: "o1", amount: 1 }]));
    await db.insertTransaction(tx("t3", "2026-03-01", [{ objectId: "o1", amount: 1 }]));
    await db.insertTransaction(tx("t2", "2026-03-01", [{ objectId: "o1", amount: 1 }]));
    const s = await db.selectLedgerState();
    expect(s.objects.map((o) => o.name)).toEqual(["Alpha", "Zeta"]);
    // date DESC, then id DESC
    expect(s.transactions.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
  });

  it("rejects duplicate ids", async () => {
    await db.insertObject(obj("o1", "A"));
    await expect(db.insertObject(obj("o1", "B"))).rejects.toThrow(/already exists/);
  });

  it("deleteObject removes its entries and any transaction left with none", async () => {
    await db.insertObject(obj("a", "A"));
    await db.insertObject(obj("b", "B"));
    await db.insertTransaction(tx("only-a", "2026-01-01", [{ objectId: "a", amount: -5 }]));
    await db.insertTransaction(
      tx("a-to-b", "2026-01-02", [
        { objectId: "a", amount: -10 },
        { objectId: "b", amount: 10 },
      ]),
    );
    await db.deleteObject("a");
    const s = await db.selectLedgerState();
    expect(s.objects.map((o) => o.id)).toEqual(["b"]);
    expect(s.transactions.map((t) => t.id)).toEqual(["a-to-b"]);
    expect(s.transactions[0].entries).toEqual([{ objectId: "b", amount: 10 }]);
  });

  it("deleteDomain cascades to accounts, goals, budgets, allocations", async () => {
    await db.insertDomain({ id: "biz", name: "Biz", kind: "business" });
    await db.insertObject(obj("x", "X", "biz"));
    await db.insertObject(obj("p", "P"));
    await db.insertGoal({
      id: "g",
      domainId: "biz",
      name: "G",
      target: 1,
      currency: "USD",
      deadline: "2030-01-01",
      priority: "med",
    });
    await db.insertTransaction(tx("t", "2026-01-01", [{ objectId: "x", amount: 1 }]));
    await db.deleteDomain("biz");
    const s = await db.selectLedgerState();
    expect(s.domains.map((d) => d.id)).toEqual(["personal"]);
    expect(s.objects.map((o) => o.id)).toEqual(["p"]);
    expect(s.goals).toEqual([]);
    expect(s.transactions).toEqual([]);
  });

  it("updateDomain distinguishes 'omitted' from 'cleared'", async () => {
    await db.updateDomain("personal", { description: "hello", displayCurrency: "NGN" });
    await db.updateDomain("personal", { name: "Home" });
    let d = (await db.selectLedgerState()).domains[0];
    expect(d).toMatchObject({ name: "Home", description: "hello", displayCurrency: "NGN" });
    await db.updateDomain("personal", { description: undefined });
    d = (await db.selectLedgerState()).domains[0];
    expect(d.description).toBeUndefined();
    expect(d.displayCurrency).toBe("NGN");
  });

  it("keeps one FX row per base and a sorted, de-duplicated currency list", async () => {
    await db.upsertFxRate({ base: "NGN", quote: "USD", rate: 0.001 });
    await db.upsertFxRate({ base: "NGN", quote: "USD", rate: 0.002 });
    await db.setCurrencyEnabled("USD", true);
    await db.setCurrencyEnabled("NGN", true);
    await db.setCurrencyEnabled("NGN", true);
    const s = await db.selectLedgerState();
    expect(s.fx).toEqual([{ base: "NGN", quote: "USD", rate: 0.002 }]);
    expect(s.currencies).toEqual(["NGN", "USD"]);
    await db.deleteFxRatesForBase("NGN");
    expect((await db.selectLedgerState()).fx).toEqual([]);
  });

  it("replaceLedger keeps the PIN; resetWorkspace wipes it", async () => {
    await db.setSetting("security_config", { pinHash: "h" });
    await db.setSetting("onboarding_state", { complete: true });
    await db.replaceLedger({
      currencies: ["USD"],
      fx: [],
      domains: [{ id: "personal", name: "P", kind: "personal" }],
      objects: [obj("o", "O")],
      categories: [],
      allocations: [],
      goals: [],
      budgets: [],
      transactions: [],
    });
    expect(await db.getSetting("security_config")).toEqual({ pinHash: "h" });
    expect((await db.selectLedgerState()).objects).toHaveLength(1);
    await db.resetWorkspace();
    expect(await db.getSetting("security_config")).toBeNull();
    expect(await db.getSetting("onboarding_state")).toBeNull();
    const s = await db.selectLedgerState();
    expect(s.objects).toEqual([]);
    expect(s.domains.map((d) => d.id)).toEqual(["personal"]);
  });
});

describe("web backend — applying cloud changes", () => {
  it("folds in upserts and tombstones, skips junk, leaves the PIN alone", async () => {
    await db.setSetting("security_config", { pinHash: "h" });
    const r = await db.applyRemoteChanges([
      { kind: "object", id: "o1", data: obj("o1", "Cash") },
      {
        kind: "transaction",
        id: "t1",
        data: tx("t1", "2026-01-02", [{ objectId: "o1", amount: -3.5 }]),
      },
      { kind: "fx", id: "NGN", data: { base: "NGN", quote: "USD", rate: 0.001 } },
      { kind: "currencies", id: "_", data: ["USD", "NGN"] },
      { kind: "bogus", id: "z", data: {} },
      { kind: "goal", id: "g", data: { not: "a goal" } },
    ]);
    expect(r).toEqual({ applied: 4, skipped: 2 });
    let s = await db.selectLedgerState();
    expect(s.objects).toHaveLength(1);
    expect(s.transactions).toHaveLength(1);
    expect(s.goals).toEqual([]);
    expect(await db.getSetting("security_config")).toEqual({ pinHash: "h" });

    await db.applyRemoteChanges([
      { kind: "transaction", id: "t1", deleted: true },
      { kind: "object", id: "o1", data: obj("o1", "Wallet") },
      { kind: "fx", id: "NGN", deleted: true },
    ]);
    s = await db.selectLedgerState();
    expect(s.transactions).toEqual([]);
    expect(s.objects[0].name).toBe("Wallet");
    expect(s.fx).toEqual([]);
  });
});

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createWebBackend } from "@/lib/db/web-backend";
import { runSyncCycle, cursorKey } from "@/lib/sync/engine";
import { ADOPTED_AT, Outbox, refOf } from "@/lib/sync/outbox";
import type { PushRow, Remote, RemoteRow } from "@/lib/sync/remote";
import type { FinancialObject, Transaction } from "@/lib/ledger/types";

/** In-memory cloud with the same rules as the SQL migration: last writer wins
 *  (strictly newer), tombstones, one increasing counter for the user. */
class FakeCloud implements Remote {
  rows = new Map<string, RemoteRow>();
  seq = 0;
  down = false;
  pushCalls = 0;
  async pull(after: number, limit: number) {
    if (this.down) throw new TypeError("Failed to fetch");
    return [...this.rows.values()]
      .filter((r) => r.server_seq > after)
      .sort((a, b) => a.server_seq - b.server_seq)
      .slice(0, limit);
  }
  async push(rows: PushRow[]) {
    if (this.down) throw new TypeError("Failed to fetch");
    this.pushCalls++;
    let applied = 0;
    for (const r of rows) {
      const k = `${r.kind}:${r.id}`;
      const cur = this.rows.get(k);
      if (cur && !(Date.parse(r.updated_at) > Date.parse(cur.updated_at))) continue;
      this.rows.set(k, { ...r, data: r.deleted ? null : r.data, server_seq: ++this.seq });
      applied++;
    }
    return applied;
  }
}

let n = 0;
async function device(cloud: FakeCloud, uid = "user-1") {
  const db = createWebBackend(`dev-${++n}-${Math.random()}`);
  await db.ensureInitialized();
  const outbox = new Outbox(db);
  await outbox.activate(uid);
  const sync = () => runSyncCycle({ db, outbox, remote: cloud, uid, pageSize: 2 });
  /** A local edit: write to the db and queue it, like the app does. */
  const edit = {
    async object(o: FinancialObject, at?: Date) {
      await db.insertObject(o);
      outbox.markChanged("object", o.id, false, at);
    },
    async tx(t: Transaction, at?: Date) {
      await db.insertTransaction(t);
      outbox.markChanged("transaction", t.id, false, at);
    },
    async retitle(id: string, description: string, at: Date) {
      await db.updateTransaction(id, { description });
      outbox.markChanged("transaction", id, false, at);
    },
    async remove(id: string, at: Date) {
      await db.deleteTransaction(id);
      outbox.markChanged("transaction", id, true, at);
    },
  };
  return { db, outbox, sync, edit };
}

const acct = (id: string, name: string): FinancialObject => ({
  id,
  domainId: "personal",
  name,
  kind: "account",
  currency: "USD",
});
const txn = (id: string, description: string): Transaction => ({
  id,
  date: "2026-02-01",
  description,
  kind: "expense",
  entries: [{ objectId: "o1", amount: -5 }],
});
const t = (s: string) => new Date(`2026-03-01T${s}Z`);

describe("sync engine — two devices", () => {
  it("what one device saves, the other receives", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("10:00:00"));
    await a.edit.tx(txn("t1", "Coffee"), t("10:00:01"));
    const ra = await a.sync();
    expect(ra).toMatchObject({ ok: true, pushed: 2 });

    const rb = await b.sync();
    expect(rb).toMatchObject({ ok: true, applied: 2 });
    const s = await b.db.selectLedgerState();
    expect(s.objects.map((o) => o.name)).toEqual(["Cash"]);
    expect(s.transactions.map((x) => x.description)).toEqual(["Coffee"]);
  });

  it("does not re-apply its own push (no pointless local rewrite)", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("10:00:00"));
    const r = await a.sync();
    expect(r).toMatchObject({ ok: true, pushed: 1, pulled: 1, applied: 0 });
    expect(a.outbox.size).toBe(0);
  });

  it("on a conflict the later edit wins on both devices", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("09:00:00"));
    await a.edit.tx(txn("t1", "original"), t("09:00:01"));
    await a.sync();
    await b.sync();

    await a.edit.retitle("t1", "from A", t("11:00:00"));
    await b.edit.retitle("t1", "from B (later)", t("11:05:00"));
    await a.sync();
    await b.sync();
    await a.sync();

    for (const d of [a, b]) {
      expect((await d.db.selectLedgerState()).transactions[0].description).toBe("from B (later)");
    }
  });

  it("a delete propagates, and an older edit cannot bring the row back", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("09:00:00"));
    await a.edit.tx(txn("t1", "x"), t("09:00:01"));
    await a.sync();
    await b.sync();

    await a.edit.remove("t1", t("12:00:00"));
    await b.edit.retitle("t1", "stale edit", t("11:00:00")); // earlier than the delete
    await a.sync();
    await b.sync();
    await a.sync();

    for (const d of [a, b]) expect((await d.db.selectLedgerState()).transactions).toEqual([]);
  });

  it("a newer pending local change is not overwritten by an incoming older one", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("09:00:00"));
    await a.edit.tx(txn("t1", "base"), t("09:00:01"));
    await a.sync();
    await b.sync();

    await a.edit.retitle("t1", "A edit", t("10:00:00"));
    await a.sync();
    // B edits later but hasn't synced; its sync pushes first, so B wins.
    await b.edit.retitle("t1", "B later", t("10:30:00"));
    await b.sync();
    expect((await b.db.selectLedgerState()).transactions[0].description).toBe("B later");
  });
});

describe("sync engine — offline and recovery", () => {
  it("keeps queued changes when the network is down and sends them later", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("09:00:00"));
    cloud.down = true;
    const r = await a.sync();
    expect(r).toMatchObject({ ok: false, offline: true });
    expect(a.outbox.size).toBe(1);
    expect((await a.db.selectLedgerState()).objects).toHaveLength(1); // still usable offline

    cloud.down = false;
    expect(await a.sync()).toMatchObject({ ok: true, pushed: 1 });
    expect(a.outbox.size).toBe(0);
    expect(cloud.rows.has("object:o1")).toBe(true);
  });

  it("an edit made while a push is in flight is not lost", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("09:00:00"));
    await a.edit.tx(txn("t1", "first"), t("09:00:01"));
    const realPush = cloud.push.bind(cloud);
    cloud.push = async (rows) => {
      const out = await realPush(rows);
      a.outbox.markChanged("transaction", "t1", false, t("09:00:09")); // edited mid-push
      return out;
    };
    await a.sync();
    expect(a.outbox.entry(refOf("transaction", "t1"))).toBeDefined();
  });
});

describe("sync engine — first sign-in on a device that already has data", () => {
  it("adds local-only data and lets the cloud win conflicts (e.g. a renamed Personal domain)", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.db.updateDomain("personal", { name: "Home" });
    a.outbox.markChanged("domain", "personal", false, t("08:00:00"));
    await a.edit.object(acct("o1", "Cloud account"), t("08:00:01"));
    await a.sync();

    // Device C has only local data from before it had an account.
    const db = createWebBackend(`dev-adopt-${Math.random()}`);
    await db.ensureInitialized();
    await db.insertObject(acct("local-1", "Local account"));
    const outbox = new Outbox(db);
    await outbox.activate("user-1");
    outbox.adoptAll(await db.selectLedgerState());
    expect(outbox.entry(refOf("domain", "personal"))?.at).toBe(ADOPTED_AT);

    const r = await runSyncCycle({ db, outbox, remote: cloud, uid: "user-1" });
    expect(r.ok).toBe(true);
    const s = await db.selectLedgerState();
    expect(s.domains.find((d) => d.id === "personal")?.name).toBe("Home"); // cloud won
    expect(s.objects.map((o) => o.id).sort()).toEqual(["local-1", "o1"]); // union
    expect(cloud.rows.has("object:local-1")).toBe(true); // local-only data was uploaded
  });
});

describe("sync engine — robustness", () => {
  it("pages through large pulls and remembers the cursor", async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.edit.object(acct("o1", "Cash"), t("09:00:00"));
    for (let i = 0; i < 5; i++) await a.edit.tx(txn(`t${i}`, `tx ${i}`), t(`09:00:${10 + i}`));
    await a.sync();

    const b = await device(cloud);
    const r = await b.sync();
    expect(r).toMatchObject({ ok: true, pulled: 6, applied: 6 });
    expect(await b.db.getSetting(cursorKey("user-1"))).toBe(cloud.seq);
    // nothing new -> nothing applied
    expect(await b.sync()).toMatchObject({ ok: true, pulled: 0, applied: 0 });
  });

  it("skips malformed rows from the server instead of failing", async () => {
    const cloud = new FakeCloud();
    cloud.rows.set("goal:g", {
      kind: "goal",
      id: "g",
      data: { junk: true },
      deleted: false,
      updated_at: "2026-01-01T00:00:00Z",
      server_seq: ++cloud.seq,
    });
    cloud.rows.set("object:o1", {
      kind: "object",
      id: "o1",
      data: acct("o1", "Fine"),
      deleted: false,
      updated_at: "2026-01-01T00:00:00Z",
      server_seq: ++cloud.seq,
    });
    const a = await device(cloud);
    expect(await a.sync()).toMatchObject({ ok: true, applied: 1, skipped: 1 });
    expect((await a.db.selectLedgerState()).objects.map((o) => o.name)).toEqual(["Fine"]);
  });

  it("different accounts never see each other's data", async () => {
    const cloudA = new FakeCloud();
    const cloudB = new FakeCloud(); // separate user = separate counter and rows
    const a = await device(cloudA, "user-a");
    const b = await device(cloudB, "user-b");
    await a.edit.object(acct("o1", "A's private account"), t("09:00:00"));
    await a.sync();
    await b.sync();
    expect((await b.db.selectLedgerState()).objects).toEqual([]);
  });
});

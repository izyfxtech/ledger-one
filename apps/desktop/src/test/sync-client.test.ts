import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "@ledgerone/sync-server/src/server";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import type { LedgerState, Domain } from "@/lib/ledger/types";

// client.ts calls `db.replaceLedger` / `db.selectLedgerState` directly
// (deliberately bypassing store.tsx's write-permission gate — see
// client.ts's header comment). Stand in for the Rust/SQLite layer with a
// plain in-memory variable so this test exercises real HTTP + real crypto
// + real merge logic without needing an actual Tauri runtime.
let fakeDb: LedgerState;
vi.mock("@/lib/db", () => ({
  replaceLedger: async (s: LedgerState) => {
    fakeDb = s;
  },
  selectLedgerState: async () => fakeDb,
}));

// Same localStorage polyfill pattern as permissions.test.ts / sync-meta-store.test.ts.
function installFakeWindow() {
  const store = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  };
  // @ts-expect-error -- deliberate test-only global polyfill
  globalThis.window = fakeWindow;
}

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

const domain = (id: string, name: string): Domain => ({ id, name, kind: "personal" });

describe("syncNow — end to end against a real server", () => {
  let server: Server;
  let serverUrl: string;

  beforeEach(async () => {
    const created = createServer(":memory:");
    server = created.server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    fakeDb = emptyState();
    installFakeWindow();
    vi.resetModules();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // @ts-expect-error -- undo the test-only polyfill
    delete globalThis.window;
  });

  it("first sync on a fresh account pushes local data up and returns it unchanged", async () => {
    const { enableNewSyncAccount } = await import("@/lib/sync/account");
    const { syncNow } = await import("@/lib/sync/client");
    const { stampUpdated } = await import("@/lib/sync/meta-store");

    await enableNewSyncAccount(serverUrl);
    stampUpdated("domain", "dom_1");
    const local: LedgerState = { ...emptyState(), domains: [domain("dom_1", "Personal")] };

    const result = await syncNow(local);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.domains).toEqual([domain("dom_1", "Personal")]);
  });

  it("a second device linking the same secret pulls down what the first device pushed", async () => {
    const { enableNewSyncAccount, loadSyncConfig, linkExistingSyncAccount } = await import("@/lib/sync/account");
    const { syncNow } = await import("@/lib/sync/client");
    const { stampUpdated } = await import("@/lib/sync/meta-store");

    // Device A pushes.
    await enableNewSyncAccount(serverUrl);
    const secret = loadSyncConfig().secret!;
    stampUpdated("domain", "dom_1");
    await syncNow({ ...emptyState(), domains: [domain("dom_1", "Personal")] });

    // Device B links with the same secret and starts from empty local state.
    fakeDb = emptyState();
    installFakeWindow(); // fresh localStorage — simulates a second device
    await linkExistingSyncAccount(serverUrl, secret);
    const result = await syncNow(emptyState());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.domains).toEqual([domain("dom_1", "Personal")]);
  });

  it("merges non-conflicting edits made on two devices between syncs", async () => {
    const { enableNewSyncAccount, loadSyncConfig, linkExistingSyncAccount } = await import("@/lib/sync/account");
    const { syncNow } = await import("@/lib/sync/client");
    const { stampUpdated } = await import("@/lib/sync/meta-store");

    // Device A establishes the account with one domain.
    await enableNewSyncAccount(serverUrl);
    const secret = loadSyncConfig().secret!;
    stampUpdated("domain", "dom_1");
    await syncNow({ ...emptyState(), domains: [domain("dom_1", "Personal")] });

    // Device B links, pulls dom_1 down, then independently adds dom_2.
    fakeDb = emptyState();
    installFakeWindow();
    await linkExistingSyncAccount(serverUrl, secret);
    const afterFirstPull = await syncNow(emptyState());
    expect(afterFirstPull.ok).toBe(true);
    stampUpdated("domain", "dom_2");
    const bLocal: LedgerState = {
      ...emptyState(),
      domains: [...(afterFirstPull.ok ? afterFirstPull.state.domains : []), domain("dom_2", "Business")],
    };
    const bResult = await syncNow(bLocal);
    expect(bResult.ok).toBe(true);
    if (bResult.ok) {
      expect(bResult.state.domains.map((d) => d.id).sort()).toEqual(["dom_1", "dom_2"]);
    }

    // Device A syncs again and should now see dom_2 too, without losing dom_1.
    fakeDb = { ...emptyState(), domains: [domain("dom_1", "Personal")] };
    installFakeWindow();
    await linkExistingSyncAccount(serverUrl, secret);
    const aResult = await syncNow(fakeDb);
    expect(aResult.ok).toBe(true);
    if (aResult.ok) {
      expect(aResult.state.domains.map((d) => d.id).sort()).toEqual(["dom_1", "dom_2"]);
    }
  });

  it("a wrong secret derives a different (empty) account, not an error — each secret is its own isolated account", async () => {
    const { enableNewSyncAccount, linkExistingSyncAccount } = await import("@/lib/sync/account");
    const { syncNow } = await import("@/lib/sync/client");
    const { stampUpdated } = await import("@/lib/sync/meta-store");

    await enableNewSyncAccount(serverUrl);
    stampUpdated("domain", "dom_1");
    await syncNow({ ...emptyState(), domains: [domain("dom_1", "Personal")] }); // establishes the real account with data

    installFakeWindow(); // wipe local config, simulating a second device
    await linkExistingSyncAccount(serverUrl, "WRONG-SECRET-ENTIRELY");
    const result = await syncNow(emptyState());
    // Succeeds, but against a brand-new, unrelated, empty account — dom_1
    // never shows up, since a mistyped secret derives a different
    // accountId rather than failing to authenticate against the real one.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.domains).toEqual([]);
  });

  it("rejects with a clear error if the local secret and accountId ever get out of sync (e.g. tampered localStorage)", async () => {
    const { enableNewSyncAccount, loadSyncConfig, saveSyncConfig } = await import("@/lib/sync/account");
    const { syncNow } = await import("@/lib/sync/client");

    await enableNewSyncAccount(serverUrl);
    await syncNow(emptyState()); // establishes the account, binding it to the real derived token

    // Simulate corruption: keep the real accountId but swap in an
    // unrelated secret, so the derived authToken no longer matches what
    // the server has on file for that accountId.
    const cfg = loadSyncConfig();
    saveSyncConfig({ ...cfg, secret: "SOME-OTHER-SECRET-VALUE" });

    const result = await syncNow(emptyState());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/credentials/i);
  });

  it("reports a clear error (not a throw) when sync isn't enabled", async () => {
    const { syncNow } = await import("@/lib/sync/client");
    const result = await syncNow(emptyState());
    expect(result).toEqual({ ok: false, error: "Sync is not enabled on this device." });
  });
});

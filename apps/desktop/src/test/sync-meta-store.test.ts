import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadSyncMeta,
  saveSyncMeta,
  stampUpdated,
  stampDeleted,
  lastTouchedAt,
  isTombstoned,
} from "@/lib/sync/meta-store";
import { entityRef } from "@/lib/sync/types";

// Same polyfill pattern as permissions.test.ts — plain Node environment,
// so localStorage doesn't exist unless we give it one.
function installFakeWindow() {
  const store = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  // @ts-expect-error -- deliberate test-only global polyfill
  globalThis.window = fakeWindow;
}

describe("sync meta-store", () => {
  beforeEach(() => installFakeWindow());
  afterEach(() => {
    // @ts-expect-error -- undo the test-only polyfill
    delete globalThis.window;
  });

  it("starts empty", () => {
    expect(loadSyncMeta()).toEqual({ updatedAt: {}, tombstones: {} });
  });

  it("stampUpdated records a timestamp for the entity", () => {
    stampUpdated("transaction", "tx_1", "2026-01-01T00:00:00.000Z");
    const meta = loadSyncMeta();
    expect(meta.updatedAt[entityRef("transaction", "tx_1")]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stampDeleted records a tombstone and clears any prior updatedAt", () => {
    stampUpdated("transaction", "tx_1", "2026-01-01T00:00:00.000Z");
    stampDeleted("transaction", "tx_1", "2026-01-02T00:00:00.000Z");
    const meta = loadSyncMeta();
    const ref = entityRef("transaction", "tx_1");
    expect(meta.tombstones[ref]).toBe("2026-01-02T00:00:00.000Z");
    expect(meta.updatedAt[ref]).toBeUndefined();
  });

  it("stampUpdated after a tombstone clears the tombstone (an undo/recreate)", () => {
    stampDeleted("transaction", "tx_1", "2026-01-01T00:00:00.000Z");
    stampUpdated("transaction", "tx_1", "2026-01-02T00:00:00.000Z");
    const meta = loadSyncMeta();
    const ref = entityRef("transaction", "tx_1");
    expect(meta.updatedAt[ref]).toBe("2026-01-02T00:00:00.000Z");
    expect(meta.tombstones[ref]).toBeUndefined();
  });

  it("lastTouchedAt returns null for an entity with no record at all", () => {
    const meta = loadSyncMeta();
    expect(lastTouchedAt(meta, entityRef("transaction", "tx_missing"))).toBeNull();
  });

  it("isTombstoned is false for an entity that was only ever updated", () => {
    stampUpdated("transaction", "tx_1");
    expect(isTombstoned(loadSyncMeta(), entityRef("transaction", "tx_1"))).toBe(false);
  });

  it("isTombstoned is true for an entity that was deleted", () => {
    stampDeleted("transaction", "tx_1");
    expect(isTombstoned(loadSyncMeta(), entityRef("transaction", "tx_1"))).toBe(true);
  });

  it("persists across loadSyncMeta calls via saveSyncMeta", () => {
    const meta = loadSyncMeta();
    meta.updatedAt[entityRef("domain", "dom_1")] = "2026-01-01T00:00:00.000Z";
    saveSyncMeta(meta);
    expect(loadSyncMeta().updatedAt[entityRef("domain", "dom_1")]).toBe("2026-01-01T00:00:00.000Z");
  });
});

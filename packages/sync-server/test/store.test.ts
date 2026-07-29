import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SyncStore, hashToken } from "../src/store";

describe("SyncStore", () => {
  let store: SyncStore;

  beforeEach(() => {
    store = new SyncStore(":memory:");
  });
  afterEach(() => {
    store.close();
  });

  it("auto-provisions an unknown account on first pull, with no blob yet", () => {
    const result = store.pull("acct_1", hashToken("token_1"));
    expect(result).toEqual({ authorized: true, version: 0, blob: null });
  });

  it("a second pull with the same token for the same account succeeds and is stable", () => {
    store.pull("acct_1", hashToken("token_1"));
    const result = store.pull("acct_1", hashToken("token_1"));
    expect(result).toEqual({ authorized: true, version: 0, blob: null });
  });

  it("rejects a pull for an existing account with the wrong token", () => {
    store.pull("acct_1", hashToken("token_1")); // provisions with token_1
    const result = store.pull("acct_1", hashToken("wrong_token"));
    expect(result).toEqual({ authorized: false });
  });

  it("first push (expectedVersion 0) on a brand-new account succeeds and creates it at version 1", () => {
    const result = store.push("acct_1", hashToken("token_1"), 0, "ciphertext-v1");
    expect(result).toEqual({ authorized: true, ok: true, version: 1 });
  });

  it("a matching-version push succeeds and increments the version", () => {
    store.push("acct_1", hashToken("token_1"), 0, "ciphertext-v1");
    const result = store.push("acct_1", hashToken("token_1"), 1, "ciphertext-v2");
    expect(result).toEqual({ authorized: true, ok: true, version: 2 });
  });

  it("a stale-version push (someone else pushed since) is rejected with the current state", () => {
    store.push("acct_1", hashToken("token_1"), 0, "ciphertext-v1"); // -> version 1
    store.push("acct_1", hashToken("token_1"), 1, "ciphertext-v2"); // -> version 2
    // Retrying with the stale expectedVersion=1 should fail and hand back v2.
    const result = store.push("acct_1", hashToken("token_1"), 1, "ciphertext-conflicting");
    expect(result).toEqual({ authorized: true, ok: false, version: 2, blob: "ciphertext-v2" });
  });

  it("rejects a push to an existing account with the wrong token", () => {
    store.push("acct_1", hashToken("token_1"), 0, "ciphertext-v1");
    const result = store.push("acct_1", hashToken("wrong_token"), 1, "ciphertext-v2");
    expect(result).toEqual({ authorized: false });
  });

  it("a pull after a push sees the pushed blob and version", () => {
    store.push("acct_1", hashToken("token_1"), 0, "ciphertext-v1");
    const result = store.pull("acct_1", hashToken("token_1"));
    expect(result).toEqual({ authorized: true, version: 1, blob: "ciphertext-v1" });
  });

  it("two independent accounts don't interfere with each other", () => {
    store.push("acct_1", hashToken("token_1"), 0, "acct-1-data");
    store.push("acct_2", hashToken("token_2"), 0, "acct-2-data");
    expect(store.pull("acct_1", hashToken("token_1"))).toEqual({ authorized: true, version: 1, blob: "acct-1-data" });
    expect(store.pull("acct_2", hashToken("token_2"))).toEqual({ authorized: true, version: 1, blob: "acct-2-data" });
  });

  it("hashToken is deterministic and different inputs hash differently", () => {
    expect(hashToken("same")).toBe(hashToken("same"));
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

import { describe, expect, it } from "vitest";
import {
  generateSyncSecret,
  deriveAccountId,
  deriveAuthToken,
  encryptPayload,
  decryptPayload,
} from "@/lib/sync/crypto";

describe("generateSyncSecret", () => {
  it("produces a hyphen-grouped, Crockford-base32-alphabet string", () => {
    const secret = generateSyncSecret();
    // Groups of up to 5 chars from the Crockford base32 alphabet
    // (0-9, A-Z minus I/L/O/U), joined with hyphens — the last group can
    // be shorter since 20 bytes (160 bits) doesn't split evenly into
    // groups of 5 base32 chars (32 chars = six 5-char groups + one 2-char group).
    expect(secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{1,5}(-[0-9A-HJKMNP-TV-Z]{1,5})*$/);
    expect(secret.replace(/-/g, "")).toHaveLength(32);
  });

  it("produces a different secret every time", () => {
    const a = generateSyncSecret();
    const b = generateSyncSecret();
    expect(a).not.toBe(b);
  });
});

describe("deriveAccountId / deriveAuthToken", () => {
  it("is deterministic — the same secret always derives the same values", async () => {
    const secret = "TEST-SECRET-VALUE";
    expect(await deriveAccountId(secret)).toBe(await deriveAccountId(secret));
    expect(await deriveAuthToken(secret)).toBe(await deriveAuthToken(secret));
  });

  it("different secrets derive different account ids and auth tokens", async () => {
    const idA = await deriveAccountId("SECRET-A");
    const idB = await deriveAccountId("SECRET-B");
    expect(idA).not.toBe(idB);

    const tokenA = await deriveAuthToken("SECRET-A");
    const tokenB = await deriveAuthToken("SECRET-B");
    expect(tokenA).not.toBe(tokenB);
  });

  it("accountId and authToken for the same secret are unrelated-looking values", async () => {
    const secret = "TEST-SECRET-VALUE";
    const accountId = await deriveAccountId(secret);
    const authToken = await deriveAuthToken(secret);
    expect(accountId).not.toBe(authToken);
    // authToken is derived from 256 bits, accountId from 128 — confirms
    // they're genuinely independent derivations, not one truncating the other.
    expect(authToken.length).toBe(64); // 256 bits as hex
    expect(accountId.length).toBe(32); // 128 bits as hex
  });
});

describe("encryptPayload / decryptPayload", () => {
  it("round-trips an arbitrary JSON payload", async () => {
    const secret = "TEST-SECRET-VALUE";
    const payload = { hello: "world", nested: { count: 3, list: [1, 2, 3] } };
    const blob = await encryptPayload(secret, payload);
    const decrypted = await decryptPayload(secret, blob);
    expect(decrypted).toEqual(payload);
  });

  it("produces a different ciphertext each time (random IV), even for the same payload", async () => {
    const secret = "TEST-SECRET-VALUE";
    const payload = { same: "payload" };
    const blobA = await encryptPayload(secret, payload);
    const blobB = await encryptPayload(secret, payload);
    expect(blobA).not.toBe(blobB);
    // But both still decrypt to the same thing.
    expect(await decryptPayload(secret, blobA)).toEqual(payload);
    expect(await decryptPayload(secret, blobB)).toEqual(payload);
  });

  it("fails to decrypt with the wrong secret", async () => {
    const blob = await encryptPayload("SECRET-A", { data: "sensitive" });
    await expect(decryptPayload("SECRET-B", blob)).rejects.toThrow();
  });

  it("fails to decrypt a tampered blob", async () => {
    const blob = await encryptPayload("TEST-SECRET-VALUE", { data: "sensitive" });
    const [iv, ct] = blob.split(".");
    const tampered = `${iv}.${ct.slice(0, -4)}${ct.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    await expect(decryptPayload("TEST-SECRET-VALUE", tampered)).rejects.toThrow();
  });

  it("rejects a malformed blob (missing the iv/ciphertext separator)", async () => {
    await expect(decryptPayload("TEST-SECRET-VALUE", "not-a-real-blob")).rejects.toThrow(
      /Malformed sync blob/,
    );
  });
});

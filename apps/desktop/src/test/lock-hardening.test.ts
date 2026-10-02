import { beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_ATTEMPTS, lockoutSeconds, pinAttempts } from "@/lib/lock";

describe("wrong-PIN throttling", () => {
  beforeEach(() => pinAttempts.reset());

  it("allows a few free guesses, then escalates and caps", () => {
    expect(lockoutSeconds(FREE_ATTEMPTS - 1)).toBe(0);
    expect(lockoutSeconds(FREE_ATTEMPTS)).toBe(30);
    expect(lockoutSeconds(FREE_ATTEMPTS + 1)).toBe(60);
    expect(lockoutSeconds(FREE_ATTEMPTS + 30)).toBe(15 * 60);
  });

  it("blocks guesses during the wait and clears on success", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < FREE_ATTEMPTS - 1; i++) pinAttempts.recordFailure(t0);
    expect(pinAttempts.remainingMs(t0)).toBe(0); // still free
    pinAttempts.recordFailure(t0); // the 5th wrong guess
    expect(pinAttempts.remainingMs(t0)).toBe(30_000);
    expect(pinAttempts.remainingMs(t0 + 31_000)).toBe(0);
    pinAttempts.recordFailure(t0 + 31_000);
    expect(pinAttempts.remainingMs(t0 + 31_000)).toBe(60_000); // doubled
    pinAttempts.recordSuccess();
    expect(pinAttempts.remainingMs(t0 + 31_000)).toBe(0);
  });
});

describe("loadSecurity fails closed", () => {
  it("rethrows when the stored config cannot be read, instead of returning 'no PIN'", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getSetting: vi.fn().mockRejectedValue(new Error("db unavailable")),
      setSetting: vi.fn(),
    }));
    const { loadSecurity } = await import("@/lib/local-store");
    await expect(loadSecurity()).rejects.toThrow("db unavailable");
    vi.doUnmock("@/lib/db");
  });
});

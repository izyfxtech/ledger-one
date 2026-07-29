import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// activateUser()'s step-up gate (and setPin/loadSecurity, which it calls
// under the hood) go through @/lib/db → invoke("db_get_setting" /
// "db_set_setting"). Back those two commands with a plain in-memory map so
// the security config round-trips within a test the same way it would
// through the real SQLite settings table.
const settingsStore = new Map<string, unknown>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "db_get_setting") return settingsStore.get(args!.key as string) ?? null;
    if (cmd === "db_set_setting") {
      settingsStore.set(args!.key as string, args!.value);
      return;
    }
    throw new Error(`permissions.test.ts: unmocked invoke command "${cmd}"`);
  },
}));

// The test environment is plain Node (see vitest.config.ts), not jsdom, so
// local-store.ts's `has()` check (`typeof window !== "undefined"`) is
// false by default and every function no-ops. Polyfill just enough of
// `window` for these tests to exercise the real code path.
function installFakeWindow() {
  const store = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // @ts-expect-error -- deliberate test-only global polyfill
  globalThis.window = fakeWindow;
}

describe("role permissions", () => {
  beforeEach(() => {
    installFakeWindow();
    settingsStore.clear();
  });
  afterEach(() => {
    // @ts-expect-error -- undo the test-only polyfill
    delete globalThis.window;
  });

  it("defaults to a single admin user with no setup", async () => {
    const { activeRole, canPerform } = await import("@/lib/local-store");
    expect(activeRole()).toBe("admin");
    expect(canPerform("write")).toBe(true);
    expect(canPerform("admin")).toBe(true);
  });

  it("blocks write and admin actions for a viewer", async () => {
    const { saveUsers, activateUser, canPerform } = await import("@/lib/local-store");
    // First call is as the default admin, which is allowed.
    saveUsers([
      { id: "u_admin", name: "Admin", role: "admin", createdAt: "2025-01-01" },
      { id: "u_viewer", name: "Viewer", role: "viewer", createdAt: "2025-01-01" },
    ]);
    expect(await activateUser("u_viewer")).toEqual({ ok: true });

    expect(canPerform("write")).toBe(false);
    expect(canPerform("admin")).toBe(false);
  });

  it("allows write but not admin actions for an editor", async () => {
    const { saveUsers, activateUser, canPerform } = await import("@/lib/local-store");
    saveUsers([
      { id: "u_admin", name: "Admin", role: "admin", createdAt: "2025-01-01" },
      { id: "u_editor", name: "Editor", role: "editor", createdAt: "2025-01-01" },
    ]);
    expect(await activateUser("u_editor")).toEqual({ ok: true });

    expect(canPerform("write")).toBe(true);
    expect(canPerform("admin")).toBe(false);
  });

  it("a viewer cannot self-promote by calling saveUsers directly", async () => {
    const { saveUsers, activateUser } = await import("@/lib/local-store");
    saveUsers([
      { id: "u_admin", name: "Admin", role: "admin", createdAt: "2025-01-01" },
      { id: "u_viewer", name: "Viewer", role: "viewer", createdAt: "2025-01-01" },
    ]);
    await activateUser("u_viewer");

    expect(() =>
      saveUsers([
        { id: "u_admin", name: "Admin", role: "admin", createdAt: "2025-01-01" },
        { id: "u_viewer", name: "Viewer", role: "admin", createdAt: "2025-01-01" }, // self-promotion attempt
      ]),
    ).toThrow(/only admins/i);
  });

  describe("activateUser() — the step-up PIN gate", () => {
    // Regression coverage for the actual vulnerability: a Viewer could
    // previously become the active Admin by calling the old
    // `setActiveUserId("u_admin")` directly — no permission or credential
    // check of any kind — which made every canPerform("admin") check
    // above bypassable in one call. activateUser() is the fix; these
    // tests pin down that stepping UP in privilege now costs a PIN
    // whenever one is configured, while stepping down (used above) stays
    // free.

    it("blocks a viewer from activating as admin without the device PIN", async () => {
      const { saveUsers, activateUser, setPin } = await import("@/lib/local-store");
      saveUsers([
        { id: "u_admin", name: "Admin", role: "admin", createdAt: "2025-01-01" },
        { id: "u_viewer", name: "Viewer", role: "viewer", createdAt: "2025-01-01" },
      ]);
      await setPin("1234"); // still active as the default admin here, so this is allowed
      await activateUser("u_viewer"); // step down: free, no PIN needed

      expect(await activateUser("u_admin")).toEqual({ ok: false, reason: "pin-required" });
      expect(await activateUser("u_admin", { pin: "0000" })).toEqual({
        ok: false,
        reason: "pin-incorrect",
      });
      expect(await activateUser("u_admin", { pin: "1234" })).toEqual({ ok: true });
    });

    it("allows stepping up freely when no PIN has been configured", async () => {
      const { saveUsers, activateUser } = await import("@/lib/local-store");
      saveUsers([
        { id: "u_admin", name: "Admin", role: "admin", createdAt: "2025-01-01" },
        { id: "u_viewer", name: "Viewer", role: "viewer", createdAt: "2025-01-01" },
      ]);
      await activateUser("u_viewer");
      // No PIN configured anywhere in this app is already the "nothing is
      // locked" state everywhere else (see LockGate) — there's no
      // credential to check, so the step-up can't be blocked on one.
      expect(await activateUser("u_admin")).toEqual({ ok: true });
    });

    it("never blocks stepping sideways or down, regardless of PIN", async () => {
      const { saveUsers, activateUser, setPin } = await import("@/lib/local-store");
      saveUsers([
        { id: "u_admin", name: "Admin", role: "admin", createdAt: "2025-01-01" },
        { id: "u_editor_a", name: "Editor A", role: "editor", createdAt: "2025-01-01" },
        { id: "u_editor_b", name: "Editor B", role: "editor", createdAt: "2025-01-01" },
      ]);
      await setPin("1234");
      expect(await activateUser("u_editor_a")).toEqual({ ok: true }); // admin -> editor: down
      expect(await activateUser("u_editor_b")).toEqual({ ok: true }); // editor -> editor: sideways
    });
  });
});

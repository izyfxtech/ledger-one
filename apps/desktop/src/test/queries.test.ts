import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockClear();
});

describe("queries.ts invoke wrappers", () => {
  it("calls the right command names with the right argument keys", async () => {
    const db = await import("@/lib/db/queries");

    await db.insertTransaction({
      id: "tx1",
      date: "2025-01-01",
      description: "x",
      kind: "expense",
      entries: [],
    });
    expect(invokeMock).toHaveBeenLastCalledWith("db_insert_transaction", {
      transaction: expect.objectContaining({ id: "tx1" }),
    });

    await db.deleteTransaction("tx1");
    expect(invokeMock).toHaveBeenLastCalledWith("db_delete_transaction", { id: "tx1" });

    await db.selectLedgerState();
    expect(invokeMock).toHaveBeenLastCalledWith("db_select_ledger_state");

    await db.ensureSeeded();
    expect(invokeMock).toHaveBeenLastCalledWith("db_ensure_seeded");

    await db.resetWorkspace();
    expect(invokeMock).toHaveBeenLastCalledWith("db_reset_workspace");
  });

  describe("updateDomain — the null-vs-omitted translation", () => {
    it("omits a key entirely from the wire payload when not in the patch", async () => {
      const db = await import("@/lib/db/queries");
      await db.updateDomain("dom1", { name: "New name" });
      const [, args] = invokeMock.mock.calls.at(-1)!;
      expect(args).toEqual({ id: "dom1", patch: { name: "New name" } });
      expect((args as { patch: object }).patch).not.toHaveProperty("displayCurrency");
      expect((args as { patch: object }).patch).not.toHaveProperty("description");
    });

    it("sends an explicit null when the patch has displayCurrency: undefined", async () => {
      // This is exactly what Domain Settings' "inherit currency" option
      // does (see domain-workspace.tsx) — undefined here means "clear",
      // not "leave alone", and would be silently dropped by
      // JSON.stringify if not translated to null before invoke() sends it.
      const db = await import("@/lib/db/queries");
      await db.updateDomain("dom1", { name: "x", description: undefined, displayCurrency: undefined });
      const [, args] = invokeMock.mock.calls.at(-1)!;
      expect(args).toEqual({
        id: "dom1",
        patch: { name: "x", displayCurrency: null, description: null },
      });
    });

    it("sends the real value when displayCurrency is set to something", async () => {
      const db = await import("@/lib/db/queries");
      await db.updateDomain("dom1", { displayCurrency: "GBP" });
      const [, args] = invokeMock.mock.calls.at(-1)!;
      expect(args).toEqual({ id: "dom1", patch: { displayCurrency: "GBP" } });
    });
  });
});

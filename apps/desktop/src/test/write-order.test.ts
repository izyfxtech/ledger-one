import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";

// The ledger relies on this: writes issued back to back (create an account,
// then its opening-balance transaction) must reach the database in order,
// while the optimistic cache update still happens immediately.
describe("scoped ledger writes", () => {
  it("runs saves one at a time in call order, but onMutate runs right away", async () => {
    const qc = new QueryClient();
    const log: string[] = [];
    const make = (name: string, ms: number) =>
      new MutationObserver(qc, {
        mutationKey: ["ledger-write"],
        scope: { id: "ledger-writes" },
        onMutate: () => void log.push(`optimistic:${name}`),
        mutationFn: async () => {
          log.push(`start:${name}`);
          await new Promise((r) => setTimeout(r, ms));
          log.push(`end:${name}`);
        },
      });
    // the first save is SLOWER; without a scope the second would finish first
    const p1 = make("account", 30).mutate();
    const p2 = make("opening-tx", 1).mutate();
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(["optimistic:account", "optimistic:opening-tx", "start:account"]);
    await Promise.all([p1, p2]);
    expect(log.slice(3)).toEqual(["end:account", "start:opening-tx", "end:opening-tx"]);
  });
});

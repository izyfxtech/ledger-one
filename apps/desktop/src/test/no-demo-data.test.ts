import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { missingFxBases } from "@/lib/ledger/selectors";
import type { LedgerState } from "@/lib/ledger/types";

const root = new URL("../..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "node_modules" || f === "target" || f === "dist" || f === "gen") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("the app ships no demo data", () => {
  it("has no embedded seed ledger", () => {
    expect(existsSync(join(root, "src-tauri/resources/ledger-seed.json"))).toBe(false);
    const rust = readFileSync(join(root, "src-tauri/src/db.rs"), "utf8");
    expect(rust).not.toMatch(/ledger-seed|SEED_LEDGER_JSON|ensure_seeded/);
  });

  it("contains none of the old demo names in app source", () => {
    const files = walk(join(root, "src")).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !f.includes("/test/"),
    );
    const offenders = files.filter((f) => /GTBank|Kuda|Atlas Studio/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("missingFxBases", () => {
  const empty = (): LedgerState => ({
    currencies: [],
    fx: [],
    domains: [{ id: "personal", name: "Personal", kind: "personal" }],
    objects: [],
    categories: [],
    allocations: [],
    goals: [],
    budgets: [],
    transactions: [],
  });

  it("is empty for an empty ledger and never needs a USD row", () => {
    expect(missingFxBases(empty())).toEqual([]);
    const s = empty();
    s.objects = [
      { id: "o", domainId: "personal", name: "Wallet", kind: "account", currency: "USD" },
    ];
    expect(missingFxBases(s)).toEqual([]);
  });

  it("reports a foreign currency until the user supplies a rate", () => {
    const s = empty();
    s.objects = [{ id: "o", domainId: "personal", name: "Bank", kind: "account", currency: "NGN" }];
    expect(missingFxBases(s)).toEqual(["NGN"]);
    s.fx = [{ base: "NGN", quote: "USD", rate: 0.001 }];
    expect(missingFxBases(s)).toEqual([]);
  });
});

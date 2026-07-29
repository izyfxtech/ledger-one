// Guards against a regression of the "Domain not found" bug: the Tauri-
// embedded seed at src-tauri/resources/ledger-seed.json was once silently
// empty (all arrays `[]`), which meant a genuinely fresh install seeded
// itself with zero domains and never recovered. Nothing caught that until
// a user hit it. This test reads the exact file Rust embeds via
// `include_str!` and validates it the same way ensure_seeded() does at
// boot (see src-tauri/src/db.rs), so a future empty/invalid/malformed
// seed fails CI instead of shipping.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ledgerStateSchema } from "@/lib/ledger/schema";

const SEED_PATH = fileURLToPath(
  new URL("../../src-tauri/resources/ledger-seed.json", import.meta.url),
);

describe("Tauri-embedded seed ledger", () => {
  it("is valid JSON matching the ledger schema", () => {
    const raw = readFileSync(SEED_PATH, "utf-8");
    const parsed = ledgerStateSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
  });

  it("is not empty — a hardcoded 'personal' domain must exist", () => {
    // App.tsx hardcodes domainId="personal" for the /personal route
    // regardless of what's actually seeded, so if this ever regresses to
    // empty, the app will 100% show "Domain not found" on first launch.
    const raw = readFileSync(SEED_PATH, "utf-8");
    const seed = JSON.parse(raw);
    expect(Array.isArray(seed.domains)).toBe(true);
    expect(seed.domains.length).toBeGreaterThan(0);
    expect(seed.domains.some((d: { id: string }) => d.id === "personal")).toBe(true);
  });
});

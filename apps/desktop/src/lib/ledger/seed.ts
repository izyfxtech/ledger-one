// Empty-ledger constant used only as the ledger store's initial React
// state, before the real hydrate effect (ensureSeeded + selectLedgerState
// in store.tsx) replaces it. Actual seeding now happens entirely in Rust
// (see src-tauri/src/db.rs's ensure_seeded/reset_workspace, both reading
// the same compile-time-embedded src-tauri/resources/ledger-seed.json) —
// the frontend never needs a JS copy of the demo data anymore.
//
// This used to be a live-primed Proxy fetched over IPC before first
// render, specifically to avoid a flash of empty content. That's no
// longer needed: LockGate and OnboardingGate (see @/components) already
// gate all real content behind their own "checking" phases until
// hydration completes, so the initial synchronous value here is never
// actually shown to the user.
import type { LedgerState } from "./types";

export const EMPTY_SEED: LedgerState = {
  currencies: [],
  fx: [],
  domains: [],
  objects: [],
  categories: [],
  allocations: [],
  goals: [],
  budgets: [],
  transactions: [],
};

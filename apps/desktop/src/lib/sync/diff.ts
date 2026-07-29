import type { LedgerState } from "@/lib/ledger/types";
import type { EntityKind } from "./types";

export type DiffAction = "upsert" | "delete";
export type DiffHandler = (kind: EntityKind, id: string, action: DiffAction) => void;

/** Diffs one id-keyed array (by reference identity, not deep-equality —
 *  every mutation in store.tsx already produces a new object reference
 *  for anything it actually changes and keeps the old reference for
 *  anything it doesn't, the same idiom React itself relies on for
 *  memoization, so `!==` is a correct and cheap "did this row change"
 *  check here). */
function diffById<T extends { id: string }>(
  kind: EntityKind,
  prev: readonly T[],
  next: readonly T[],
  onChange: DiffHandler,
) {
  const prevById = new Map(prev.map((x) => [x.id, x]));
  const nextIds = new Set<string>();
  for (const item of next) {
    nextIds.add(item.id);
    if (prevById.get(item.id) !== item) onChange(kind, item.id, "upsert");
  }
  for (const item of prev) {
    if (!nextIds.has(item.id)) onChange(kind, item.id, "delete");
  }
}

/** Diffs `fx`, which has no `id` field — each row is uniquely keyed by
 *  its `base` currency (store.tsx's upsertFxRate enforces at most one row
 *  per base). */
function diffFx(prev: LedgerState["fx"], next: LedgerState["fx"], onChange: DiffHandler) {
  const prevByBase = new Map(prev.map((x) => [x.base, x]));
  const nextBases = new Set<string>();
  for (const item of next) {
    nextBases.add(item.base);
    if (prevByBase.get(item.base) !== item) onChange("fx", item.base, "upsert");
  }
  for (const item of prev) {
    if (!nextBases.has(item.base)) onChange("fx", item.base, "delete");
  }
}

/** Walks every entity kind in a LedgerState and reports what changed
 *  between `prev` and `next`. `settings` and `currencies` aren't arrays,
 *  so they're reported as a single upsert (never a delete — there's
 *  nothing to tombstone) whenever their reference changes. Call this from
 *  a single choke point (see store.tsx's post-hydration diff effect)
 *  rather than instrumenting every mutation function individually — that
 *  way a future mutation added to the store is covered automatically
 *  instead of silently falling outside sync's notice. */
export function diffLedgerState(prev: LedgerState, next: LedgerState, onChange: DiffHandler) {
  diffById("domain", prev.domains, next.domains, onChange);
  diffById("object", prev.objects, next.objects, onChange);
  diffById("category", prev.categories, next.categories, onChange);
  diffById("allocation", prev.allocations, next.allocations, onChange);
  diffById("goal", prev.goals, next.goals, onChange);
  diffById("budget", prev.budgets, next.budgets, onChange);
  diffById("transaction", prev.transactions, next.transactions, onChange);
  diffFx(prev.fx, next.fx, onChange);
  if (prev.settings !== next.settings) onChange("settings", "_", "upsert");
  if (prev.currencies !== next.currencies) onChange("currencies", "_", "upsert");
}

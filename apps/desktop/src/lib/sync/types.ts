import type { LedgerState } from "@/lib/ledger/types";

/** Every independently-syncable "thing" in a LedgerState. The five
 *  id-keyed arrays (domains/objects/categories/allocations/goals/budgets/
 *  transactions) are diffed and merged per-row. `fx` has no `id` field —
 *  it's keyed by `base` instead, so it gets its own kind. `settings` and
 *  `currencies` aren't arrays at all — each is treated as a single
 *  whole-object entity under a synthetic id, since they're small,
 *  infrequently-changed, and not worth a per-field merge. */
export type EntityKind =
  | "domain"
  | "object"
  | "category"
  | "allocation"
  | "goal"
  | "budget"
  | "transaction"
  | "fx"
  | "settings"
  | "currencies";

/** A stable reference to one entity: e.g. "transaction:tx_abc123", or
 *  "settings:_" / "currencies:_" for the two singleton kinds. */
export type EntityRef = `${EntityKind}:${string}`;

export function entityRef(kind: EntityKind, id: string): EntityRef {
  return `${kind}:${id}`;
}

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

/** Bookkeeping this device keeps about every entity it has ever written,
 *  entirely separate from the ledger data itself — see meta-store.ts. This
 *  is what makes cross-device merge possible: without a per-entity
 *  timestamp, two devices merging their full states would have no way to
 *  know which of two conflicting versions of the same row is newer. */
export type SyncMeta = {
  /** EntityRef -> ISO timestamp this device last wrote that entity. */
  updatedAt: Record<string, string>;
  /** EntityRef -> ISO timestamp this device deleted that entity. A
   *  tombstone, not a data field — kept so OTHER devices know to also
   *  remove it, since a plain absence from `state` is indistinguishable
   *  from "never existed" or "just hasn't synced yet". */
  tombstones: Record<string, string>;
};

export function emptySyncMeta(): SyncMeta {
  return { updatedAt: {}, tombstones: {} };
}

/** What actually gets encrypted and pushed/pulled — the full ledger state
 *  plus the metadata needed to merge it against another device's copy. */
export type SyncPayload = {
  state: LedgerState;
  meta: SyncMeta;
  /** Wall-clock time this payload was assembled, for diagnostics only —
   *  merge decisions are made per-entity from `meta`, never from this. */
  packedAt: string;
};

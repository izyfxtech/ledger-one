import type {
  Allocation,
  Budget,
  CurrencyCode,
  Domain,
  FinancialObject,
  FxRate,
  Goal,
  LedgerState,
  Transaction,
  WorkspaceSettings,
} from "@/lib/ledger/types";
import { entityRef, type EntityKind, type EntityRef, type SyncMeta } from "./types";
import { isTombstoned, lastTouchedAt } from "./meta-store";

export type Side = { state: LedgerState; meta: SyncMeta };

/** Everything mergeById needs to know about "the other side" for a
 *  single row it's deciding on. */
type Verdict = "keep-a" | "keep-b" | "deleted";

function decide(refA: EntityRef, metaA: SyncMeta, refB: EntityRef, metaB: SyncMeta): Verdict {
  const tA = lastTouchedAt(metaA, refA);
  const tB = lastTouchedAt(metaB, refB);
  const delA = isTombstoned(metaA, refA);
  const delB = isTombstoned(metaB, refB);

  // No record on either side (shouldn't normally happen — every write
  // through store.tsx's diff effect stamps something — but a row with no
  // timestamp anywhere can't be reasoned about, so treat it as present
  // and prefer keeping it over guessing it should be deleted).
  if (tA == null && tB == null) return delA || delB ? "deleted" : "keep-a";
  if (tA == null) return delB ? "deleted" : "keep-b";
  if (tB == null) return delA ? "deleted" : "keep-a";

  if (tA > tB) return delA ? "deleted" : "keep-a";
  if (tB > tA) return delB ? "deleted" : "keep-b";
  // Exact tie (identical timestamp from both sides, e.g. a row neither
  // side has touched since it first arrived from the other) — a tombstone
  // on either side wins a tie, since "was deleted" is a stronger signal
  // than "wasn't re-examined"; otherwise it genuinely doesn't matter which
  // side's copy survives, so keep A for determinism.
  if (delA || delB) return "deleted";
  return "keep-a";
}

/** Merges one id-keyed array from both sides into a single result,
 *  consulting each side's SyncMeta to decide, per row, whether A's
 *  version, B's version, or neither (tombstoned) should survive. */
function mergeById<T extends { id: string }>(
  kind: EntityKind,
  a: readonly T[],
  metaA: SyncMeta,
  b: readonly T[],
  metaB: SyncMeta,
): T[] {
  const aById = new Map(a.map((x) => [x.id, x]));
  const bById = new Map(b.map((x) => [x.id, x]));
  const allIds = new Set([...aById.keys(), ...bById.keys()]);
  const out: T[] = [];
  for (const id of allIds) {
    const refA = entityRef(kind, id);
    const refB = entityRef(kind, id);
    const verdict = decide(refA, metaA, refB, metaB);
    if (verdict === "deleted") continue;
    const row = verdict === "keep-a" ? aById.get(id) ?? bById.get(id) : bById.get(id) ?? aById.get(id);
    if (row) out.push(row);
  }
  return out;
}

function mergeFx(a: readonly FxRate[], metaA: SyncMeta, b: readonly FxRate[], metaB: SyncMeta): FxRate[] {
  const aByBase = new Map(a.map((x) => [x.base, x]));
  const bByBase = new Map(b.map((x) => [x.base, x]));
  const allBases = new Set([...aByBase.keys(), ...bByBase.keys()]);
  const out: FxRate[] = [];
  for (const base of allBases) {
    const ref = entityRef("fx", base);
    const verdict = decide(ref, metaA, ref, metaB);
    if (verdict === "deleted") continue;
    const row = verdict === "keep-a" ? aByBase.get(base) ?? bByBase.get(base) : bByBase.get(base) ?? aByBase.get(base);
    if (row) out.push(row);
  }
  return out;
}

function mergeSingleton<T>(
  kind: EntityKind,
  a: T | undefined,
  metaA: SyncMeta,
  b: T | undefined,
  metaB: SyncMeta,
): T | undefined {
  const ref = entityRef(kind, "_");
  const tA = lastTouchedAt(metaA, ref);
  const tB = lastTouchedAt(metaB, ref);
  if (tA == null && tB == null) return a ?? b;
  if (tA == null) return b ?? a;
  if (tB == null) return a ?? b;
  return tB > tA ? (b ?? a) : (a ?? b);
}

/** Merges two devices' full ledger snapshots into one. Every entity kind
 *  is reconciled independently and per-row (per-base for fx, whole-object
 *  for settings/currencies) using each side's SyncMeta — see decide()
 *  above for the actual conflict rule (newest touch wins; a delete beats
 *  an untouched copy; ties are broken by preferring a delete, then by
 *  picking side A for determinism).
 *
 * The result's SyncMeta is the union of both sides' bookkeeping (taking
 * the newer timestamp per entry), so the merged result can immediately
 * be used as the new local baseline without losing history either side
 * already had.
 */
export function mergeLedgerStates(a: Side, b: Side): Side {
  const mergedMeta: SyncMeta = { updatedAt: {}, tombstones: {} };
  for (const meta of [a.meta, b.meta]) {
    for (const [ref, t] of Object.entries(meta.updatedAt)) {
      if (!mergedMeta.updatedAt[ref] || t > mergedMeta.updatedAt[ref]) mergedMeta.updatedAt[ref] = t;
    }
    for (const [ref, t] of Object.entries(meta.tombstones)) {
      if (!mergedMeta.tombstones[ref] || t > mergedMeta.tombstones[ref]) mergedMeta.tombstones[ref] = t;
    }
  }
  // A tombstone and an updatedAt for the same ref can both survive the
  // union above if they came from different sides with different
  // timestamps — keep only whichever is actually newer, per ref, so the
  // merged meta is self-consistent (mirrors stampUpdated/stampDeleted's
  // own invariant of at most one of the two per ref).
  for (const ref of Object.keys(mergedMeta.updatedAt)) {
    if (ref in mergedMeta.tombstones) {
      if (mergedMeta.tombstones[ref] >= mergedMeta.updatedAt[ref]) delete mergedMeta.updatedAt[ref];
      else delete mergedMeta.tombstones[ref];
    }
  }

  const state: LedgerState = {
    currencies: (mergeSingleton("currencies", a.state.currencies, a.meta, b.state.currencies, b.meta) ??
      []) as CurrencyCode[],
    fx: mergeFx(a.state.fx, a.meta, b.state.fx, b.meta),
    domains: mergeById<Domain>("domain", a.state.domains, a.meta, b.state.domains, b.meta),
    objects: mergeById<FinancialObject>("object", a.state.objects, a.meta, b.state.objects, b.meta),
    categories: mergeById("category", a.state.categories, a.meta, b.state.categories, b.meta),
    allocations: mergeById<Allocation>("allocation", a.state.allocations, a.meta, b.state.allocations, b.meta),
    goals: mergeById<Goal>("goal", a.state.goals, a.meta, b.state.goals, b.meta),
    budgets: mergeById<Budget>("budget", a.state.budgets, a.meta, b.state.budgets, b.meta),
    transactions: mergeById<Transaction>("transaction", a.state.transactions, a.meta, b.state.transactions, b.meta),
    settings: mergeSingleton<WorkspaceSettings>("settings", a.state.settings, a.meta, b.state.settings, b.meta),
  };

  return { state, meta: mergedMeta };
}

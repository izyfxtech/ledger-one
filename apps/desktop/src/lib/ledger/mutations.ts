// Pure state transitions for deletions. The Rust side (db.rs) implements the
// same rules in SQL; keeping a pure TypeScript twin lets the in-memory state
// move instantly and lets the rules be unit-tested. If you change one, change
// the other (the matching Rust tests are in db.rs).
import type { Budget, Goal, LedgerState, Transaction } from "./types";

/** Appended to `notes` when a transaction loses a counterpart. Keep in sync
 *  with `detach_objects` in src-tauri/src/db.rs. */
export const DETACH_NOTE = "Voided: counterpart account was deleted";

/**
 * Remove accounts from transactions without corrupting what is left:
 *  - a transaction whose entries are ALL on the removed accounts is deleted;
 *  - one that also touches surviving accounts (a transfer) keeps its surviving
 *    legs but is voided with a note, so it stays on record but no longer
 *    counts toward any balance (dropping one leg would leave a one-sided
 *    entry that still moved the surviving account's balance);
 *  - a transaction that never touched them is left exactly as it was.
 */
export function detachObjects(
  transactions: Transaction[],
  ids: ReadonlySet<string>,
): Transaction[] {
  return transactions.flatMap((t) => {
    const touched = t.entries.some((e) => ids.has(e.objectId));
    if (!touched) return [t];
    const rest = t.entries.filter((e) => !ids.has(e.objectId));
    if (rest.length === 0) return [];
    return [
      {
        ...t,
        status: "void" as const,
        notes: t.notes ? `${t.notes} | ${DETACH_NOTE}` : DETACH_NOTE,
        entries: rest,
      },
    ];
  });
}

export function deleteObjectFromState(s: LedgerState, id: string): LedgerState {
  return {
    ...s,
    objects: s.objects.filter((o) => o.id !== id),
    transactions: detachObjects(s.transactions, new Set([id])),
  };
}

export function deleteDomainFromState(s: LedgerState, id: string): LedgerState {
  const objectIds = new Set(s.objects.filter((o) => o.domainId === id).map((o) => o.id));
  const allocIds = new Set(s.allocations.filter((a) => a.domainId === id).map((a) => a.id));
  const goalIds = new Set(s.goals.filter((g) => g.domainId === id).map((g) => g.id));
  return {
    ...s,
    domains: s.domains.filter((d) => d.id !== id),
    objects: s.objects.filter((o) => o.domainId !== id),
    allocations: s.allocations.filter((a) => a.domainId !== id),
    goals: s.goals
      .filter((g) => g.domainId !== id)
      .map((g) =>
        g.linkedAllocationId && allocIds.has(g.linkedAllocationId)
          ? { ...g, linkedAllocationId: undefined }
          : g,
      ),
    budgets: s.budgets.filter((b) => b.domainId !== id),
    transactions: detachObjects(s.transactions, objectIds).map((t) => ({
      ...t,
      entries: t.entries.map((e) => ({
        ...e,
        allocationId: e.allocationId && allocIds.has(e.allocationId) ? undefined : e.allocationId,
        goalId: e.goalId && goalIds.has(e.goalId) ? undefined : e.goalId,
      })),
    })),
  };
}

export function deleteGoalFromState(s: LedgerState, id: string): LedgerState {
  return {
    ...s,
    goals: s.goals.filter((g) => g.id !== id),
    transactions: s.transactions.map((t) => ({
      ...t,
      entries: t.entries.map((e) => (e.goalId === id ? { ...e, goalId: undefined } : e)),
    })),
  };
}

export function deleteAllocationFromState(s: LedgerState, id: string): LedgerState {
  return {
    ...s,
    allocations: s.allocations.filter((a) => a.id !== id),
    goals: s.goals.map((g): Goal =>
      g.linkedAllocationId === id ? { ...g, linkedAllocationId: undefined } : g,
    ),
    transactions: s.transactions.map((t) => ({
      ...t,
      entries: t.entries.map((e) =>
        e.allocationId === id ? { ...e, allocationId: undefined } : e,
      ),
    })),
  };
}

/** Delete a category. With `reassignTo` it is a merge (entries and budget
 *  lines move to the target; duplicate lines are summed). Without it, tagged
 *  entries become uncategorised and the category's budget lines are dropped.
 *  Children are promoted to top level either way. */
export function deleteCategoryFromState(
  s: LedgerState,
  id: string,
  reassignTo?: string,
): LedgerState {
  const merge = reassignTo && reassignTo !== id ? reassignTo : undefined;
  const budgets: Budget[] = s.budgets.map((b) => {
    if (!merge) return { ...b, lines: b.lines.filter((l) => l.categoryId !== id) };
    const lines: Budget["lines"] = [];
    for (const l of b.lines) {
      const cid = l.categoryId === id ? merge : l.categoryId;
      const existing = lines.find((x) => x.categoryId === cid);
      if (existing) existing.amount += l.amount;
      else lines.push({ ...l, categoryId: cid });
    }
    return { ...b, lines };
  });
  return {
    ...s,
    categories: s.categories
      .filter((c) => c.id !== id)
      .map((c) => (c.parentId === id ? { ...c, parentId: undefined } : c)),
    budgets,
    transactions: s.transactions.map((t) => ({
      ...t,
      entries: t.entries.map((e) => (e.categoryId === id ? { ...e, categoryId: merge } : e)),
    })),
  };
}

/** Fields that may be cleared by passing `undefined` in a patch. Everything
 *  else treats `undefined` as "leave alone". Mirrors the Rust patch structs
 *  (ObjectPatch, TransactionPatch, GoalPatch, AllocationPatch, CategoryPatch). */
export const CLEARABLE = {
  object: ["institution", "interestRate", "minPayment", "creditLimit", "dueDay"],
  transaction: ["notes"],
  goal: ["priority", "linkedAllocationId", "notes"],
  allocation: ["target"],
  category: ["parentId"],
} as const;

/** Apply a patch the way the SQL backend does: omitted/undefined keys are
 *  left alone, except the `clearable` ones, where a PRESENT key whose value is
 *  `undefined` removes the field. */
export function applyPatch<T extends object>(
  target: T,
  patch: { [K in keyof T]?: T[K] | undefined },
  clearable: readonly string[],
): T {
  const next: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      if (clearable.includes(k)) delete next[k];
    } else next[k] = v;
  }
  return next as T;
}

/**
 * Make a ledger that arrived from outside (cloud pull, import, backup restore)
 * internally consistent: drop or clear references to things that no longer
 * exist. A transaction that loses one leg but keeps another is voided with a
 * note (same rule as account deletion), so every device derives the same
 * result from the same data. Twin of `sanitize_ledger` in src-tauri/src/db.rs.
 */
export function sanitizeLedger(s: LedgerState): LedgerState {
  // The built-in "personal" workspace is created locally on first run, so data
  // pulled from the cloud can arrive BEFORE it exists on a fresh device. That is
  // not a dangling reference: recreate it rather than discarding everything
  // that belongs to it.
  const refsPersonal =
    s.objects.some((o) => o.domainId === "personal") ||
    s.allocations.some((a) => a.domainId === "personal") ||
    s.goals.some((g) => g.domainId === "personal") ||
    s.budgets.some((b) => b.domainId === "personal");
  if (refsPersonal && !s.domains.some((d) => d.id === "personal")) {
    s = { ...s, domains: [...s.domains, { id: "personal", name: "Personal", kind: "personal" }] };
  }
  const domainIds = new Set(s.domains.map((d) => d.id));
  const objects = s.objects.filter((o) => domainIds.has(o.domainId));
  const allocations = s.allocations.filter((a) => domainIds.has(a.domainId));
  const goals0 = s.goals.filter((g) => domainIds.has(g.domainId));
  const catIds = new Set(s.categories.map((c) => c.id));
  const categories = s.categories.map((c) =>
    c.parentId && (!catIds.has(c.parentId) || c.parentId === c.id)
      ? { ...c, parentId: undefined }
      : c,
  );
  const objectIds = new Set(objects.map((o) => o.id));
  const allocIds = new Set(allocations.map((a) => a.id));
  const goalIds = new Set(goals0.map((g) => g.id));
  const goals = goals0.map((g) =>
    g.linkedAllocationId && !allocIds.has(g.linkedAllocationId)
      ? { ...g, linkedAllocationId: undefined }
      : g,
  );
  const budgets = s.budgets
    .filter((b) => domainIds.has(b.domainId))
    .map((b) => ({ ...b, lines: b.lines.filter((l) => catIds.has(l.categoryId)) }));

  const transactions = s.transactions.flatMap((t) => {
    const entries = t.entries.filter((e) => objectIds.has(e.objectId));
    if (entries.length === 0) return [];
    const lostLeg = entries.length < t.entries.length;
    const cleaned = entries.map((e) => ({
      ...e,
      categoryId: e.categoryId && !catIds.has(e.categoryId) ? undefined : e.categoryId,
      allocationId: e.allocationId && !allocIds.has(e.allocationId) ? undefined : e.allocationId,
      goalId: e.goalId && !goalIds.has(e.goalId) ? undefined : e.goalId,
    }));
    return [
      lostLeg
        ? {
            ...t,
            status: "void" as const,
            notes: t.notes ? `${t.notes} | ${DETACH_NOTE}` : DETACH_NOTE,
            entries: cleaned,
          }
        : { ...t, entries: cleaned },
    ];
  });
  return { ...s, objects, allocations, goals, categories, budgets, transactions };
}

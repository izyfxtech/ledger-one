import type { LedgerBackend, RemoteChange } from "@/lib/db/backend";
import type { LedgerState } from "@/lib/ledger/types";
import { Outbox, splitRef } from "./outbox";
import type { PushRow, Remote, RemoteRow } from "./remote";

export type SyncOutcome =
  | { ok: true; pushed: number; pulled: number; applied: number; skipped: number }
  | { ok: false; error: string; offline: boolean };

type Db = Pick<
  LedgerBackend,
  "getSetting" | "setSetting" | "selectLedgerState" | "applyRemoteChanges"
>;

export type EngineDeps = {
  db: Db;
  outbox: Outbox;
  remote: Remote;
  uid: string;
  /** Resolve when no local edit is still being written. */
  waitForIdle?: () => Promise<void>;
  pageSize?: number;
};

export const cursorKey = (uid: string) => `sync_cursor:${uid}`;

/** The current JSON body of an entity, or undefined if it isn't there. */
function lookup(state: LedgerState, kind: string, id: string): unknown {
  switch (kind) {
    case "domain":
      return state.domains.find((x) => x.id === id);
    case "object":
      return state.objects.find((x) => x.id === id);
    case "category":
      return state.categories.find((x) => x.id === id);
    case "allocation":
      return state.allocations.find((x) => x.id === id);
    case "goal":
      return state.goals.find((x) => x.id === id);
    case "budget":
      return state.budgets.find((x) => x.id === id);
    case "transaction":
      return state.transactions.find((x) => x.id === id);
    case "fx":
      return state.fx.find((x) => x.base === id);
    case "settings":
      return state.settings;
    case "currencies":
      return state.currencies;
    default:
      return undefined;
  }
}

/** Network trouble, as opposed to the server refusing us. */
export function isOfflineError(err: unknown): boolean {
  const e = err as { name?: string; message?: string; status?: number } | null;
  if (!e) return false;
  if (e.name === "AuthRetryableFetchError") return true;
  if (e.name === "TypeError" && /fetch|network|load failed/i.test(e.message ?? "")) return true;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONN|ENOTFOUND/i.test(
    e.message ?? "",
  );
}

/**
 * One full cycle: push what changed here, then pull what changed elsewhere.
 *
 *  - Pushing first lets the server's last-writer-wins settle conflicts; the
 *    pull that follows then brings back whichever side won.
 *  - Pulled changes go in through db.applyRemoteChanges, which is atomic and
 *    never overwrites the PIN, onboarding or tour settings.
 *  - A pulled row is skipped if this device has a newer change still waiting
 *    to be pushed (that change will win on the next push).
 */
export async function runSyncCycle(deps: EngineDeps): Promise<SyncOutcome> {
  const { db, outbox, remote, uid } = deps;
  const pageSize = deps.pageSize ?? 1000;

  try {
    await deps.waitForIdle?.();
    await outbox.flush();

    // ---- push ---------------------------------------------------------
    const sent = outbox.pending();
    const pushedKeys = new Set<string>();
    let pushed = 0;
    if (sent.length > 0) {
      const state = await db.selectLedgerState();
      const rows: PushRow[] = [];
      const ackable: typeof sent = [];
      for (const [ref, entry] of sent) {
        const { kind, id } = splitRef(ref);
        if (entry.deleted) {
          rows.push({ kind, id, data: null, deleted: true, updated_at: entry.at });
          ackable.push([ref, entry]);
          continue;
        }
        const body = lookup(state, kind, id);
        if (body === undefined) {
          // Gone locally without a delete being recorded (e.g. replaced by an
          // incoming change). Nothing to send.
          ackable.push([ref, entry]);
          continue;
        }
        rows.push({ kind, id, data: body, deleted: false, updated_at: entry.at });
        ackable.push([ref, entry]);
      }
      if (rows.length > 0) {
        pushed = await remote.push(rows);
        for (const r of rows) pushedKeys.add(`${r.kind}:${r.id}@${Date.parse(r.updated_at)}`);
      }
      outbox.ack(ackable);
      await outbox.flush();
    }

    // ---- pull ---------------------------------------------------------
    const stored = await db.getSetting(cursorKey(uid));
    const cursor = typeof stored === "number" ? stored : Number(stored) || 0;
    const rows: RemoteRow[] = [];
    let after = cursor;
    for (;;) {
      const page = await remote.pull(after, pageSize);
      rows.push(...page);
      if (page.length < pageSize) break;
      after = page[page.length - 1].server_seq;
    }

    const changes: RemoteChange[] = [];
    for (const row of rows) {
      const ref = `${row.kind}:${row.id}`;
      // Our own push coming back to us.
      if (pushedKeys.has(`${ref}@${Date.parse(row.updated_at)}`)) continue;
      // A newer local change is waiting; it will win when pushed.
      const local = outbox.entry(ref);
      if (local && local.at > row.updated_at) continue;
      changes.push({ kind: row.kind, id: row.id, data: row.data, deleted: row.deleted });
    }

    let applied = 0;
    let skipped = 0;
    if (changes.length > 0) {
      const r = await db.applyRemoteChanges(changes);
      applied = r.applied;
      skipped = r.skipped;
    }

    if (rows.length > 0) {
      await db.setSetting(cursorKey(uid), rows[rows.length - 1].server_seq);
    }

    return { ok: true, pushed, pulled: rows.length, applied, skipped };
  } catch (err) {
    return {
      ok: false,
      offline: isOfflineError(err),
      error:
        err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err),
    };
  }
}

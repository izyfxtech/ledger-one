import type { LedgerBackend } from "@/lib/db/backend";
import type { LedgerState } from "@/lib/ledger/types";
import type { EntityKind } from "./types";

/**
 * The list of entities this device has changed but not yet pushed.
 *
 * Replaces the old per-entity meta store. Each entry says WHEN the entity was
 * last changed here (that time is the conflict-resolution key on the server)
 * and whether the change was a delete. It lives in the local database's
 * settings table, so it survives restarts and is tied to the account it
 * belongs to.
 */
export type OutboxEntry = { at: string; deleted: boolean };

/** Entities that existed before an account was linked get this time, so that
 *  anything already in the cloud wins a conflict and local-only things are
 *  simply added. */
export const ADOPTED_AT = "1970-01-01T00:00:00.000Z";

export const refOf = (kind: EntityKind | string, id: string) => `${kind}:${id}`;
export function splitRef(ref: string): { kind: string; id: string } {
  const i = ref.indexOf(":");
  return { kind: ref.slice(0, i), id: ref.slice(i + 1) };
}

type Db = Pick<LedgerBackend, "getSetting" | "setSetting">;

export class Outbox {
  private map = new Map<string, OutboxEntry>();
  private uid: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private db: Db) {}

  private key(uid: string) {
    return `sync_outbox:${uid}`;
  }

  /** Start tracking for this account (loads whatever was saved). */
  async activate(uid: string): Promise<void> {
    this.uid = uid;
    this.map = new Map();
    const raw = await this.db.getSetting(this.key(uid));
    if (raw && typeof raw === "object") {
      for (const [ref, e] of Object.entries(raw as Record<string, OutboxEntry>)) {
        if (e && typeof e.at === "string") this.map.set(ref, { at: e.at, deleted: !!e.deleted });
      }
    }
  }

  deactivate() {
    this.uid = null;
    this.map = new Map();
  }

  get active() {
    return this.uid !== null;
  }

  /** Record a local change. No-op when no account is linked (local-only use
   *  needs no bookkeeping). */
  markChanged(kind: EntityKind, id: string, deleted: boolean, now = new Date()) {
    if (!this.uid) return;
    const ref = refOf(kind, id);
    let at = now.toISOString();
    const prev = this.map.get(ref);
    // Strictly increasing per entity, so "was it changed again while a push
    // was in flight?" can be answered by comparing timestamps.
    if (prev && prev.at >= at) at = new Date(Date.parse(prev.at) + 1).toISOString();
    this.map.set(ref, { at, deleted });
    this.persist();
  }

  pending(): Array<[string, OutboxEntry]> {
    return [...this.map.entries()];
  }

  get size() {
    return this.map.size;
  }

  entry(ref: string): OutboxEntry | undefined {
    return this.map.get(ref);
  }

  /** Forget entries that were pushed — but only if they weren't changed
   *  again after we read them. */
  ack(sent: Array<[string, OutboxEntry]>) {
    for (const [ref, e] of sent) {
      if (this.map.get(ref)?.at === e.at) this.map.delete(ref);
    }
    this.persist();
  }

  /** Queue everything currently in `state` for upload at ADOPTED_AT, without
   *  touching entities that already have a real pending change. */
  adoptAll(state: LedgerState) {
    if (!this.uid) return;
    const add = (kind: EntityKind, id: string) => {
      const ref = refOf(kind, id);
      if (!this.map.has(ref)) this.map.set(ref, { at: ADOPTED_AT, deleted: false });
    };
    state.domains.forEach((x) => add("domain", x.id));
    state.objects.forEach((x) => add("object", x.id));
    state.categories.forEach((x) => add("category", x.id));
    state.allocations.forEach((x) => add("allocation", x.id));
    state.goals.forEach((x) => add("goal", x.id));
    state.budgets.forEach((x) => add("budget", x.id));
    state.transactions.forEach((x) => add("transaction", x.id));
    state.fx.forEach((x) => add("fx", x.base));
    if (state.settings) add("settings", "_");
    if (state.currencies.length > 0) add("currencies", "_");
    this.persist();
  }

  /** Resolves once everything queued so far is written to disk. */
  flush(): Promise<unknown> {
    return this.chain;
  }

  private persist() {
    const uid = this.uid;
    if (!uid) return;
    const snapshot = Object.fromEntries(this.map);
    // Serialised so the last write always wins in order.
    this.chain = this.chain
      .then(() => this.db.setSetting(this.key(uid), snapshot))
      .catch((err) => console.error("[sync] could not save outbox:", err));
  }
}

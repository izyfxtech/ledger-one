// Bookkeeping for cross-device merge — entirely separate from the ledger
// itself (which lives in SQLite) and from Users & Permissions / the device
// PIN (which live in localStorage already, see local-store.ts). This is
// device-local, not ledger data, so localStorage is the right home for it:
// a fresh install with no ledger has no sync history either, and "Reset
// workspace" naturally invalidates it too (there's nothing meaningful left
// to compare against once the data it describes is gone).
import type { EntityKind, EntityRef, SyncMeta } from "./types";
import { emptySyncMeta, entityRef } from "./types";

const has = () => typeof window !== "undefined";
const META_KEY = "ledgerone.syncMeta.v1";

export function loadSyncMeta(): SyncMeta {
  if (!has()) return emptySyncMeta();
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return emptySyncMeta();
    const parsed = JSON.parse(raw);
    return {
      updatedAt: parsed?.updatedAt && typeof parsed.updatedAt === "object" ? parsed.updatedAt : {},
      tombstones: parsed?.tombstones && typeof parsed.tombstones === "object" ? parsed.tombstones : {},
    };
  } catch {
    return emptySyncMeta();
  }
}

export function saveSyncMeta(meta: SyncMeta) {
  if (!has()) return;
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

/** Record that this device wrote (created or edited) an entity just now.
 *  Clears any prior tombstone for the same id — a live row always wins
 *  over a stale delete record for the same identity. */
export function stampUpdated(kind: EntityKind, id: string, at: string = new Date().toISOString()) {
  const meta = loadSyncMeta();
  const ref = entityRef(kind, id);
  meta.updatedAt[ref] = at;
  delete meta.tombstones[ref];
  saveSyncMeta(meta);
}

/** Record that this device deleted an entity just now. Clears the
 *  updatedAt entry — a tombstone alone is enough to represent "gone", and
 *  keeping both would leave stale ambiguity about which one is current. */
export function stampDeleted(kind: EntityKind, id: string, at: string = new Date().toISOString()) {
  const meta = loadSyncMeta();
  const ref = entityRef(kind, id);
  meta.tombstones[ref] = at;
  delete meta.updatedAt[ref];
  saveSyncMeta(meta);
}

/** For a given entity ref, the single timestamp that matters for merge
 *  purposes: whichever of "last updated" / "last deleted" happened most
 *  recently. Returns null if this device has no record of the entity at
 *  all (e.g. it arrived from another device and was applied locally
 *  without ever being stamped — see client.ts, which stamps on apply too,
 *  so in practice this null case is mainly a defensive fallback).
 */
export function lastTouchedAt(meta: SyncMeta, ref: EntityRef): string | null {
  const u = meta.updatedAt[ref];
  const d = meta.tombstones[ref];
  if (u && d) return u > d ? u : d;
  return u ?? d ?? null;
}

export function isTombstoned(meta: SyncMeta, ref: EntityRef): boolean {
  const u = meta.updatedAt[ref];
  const d = meta.tombstones[ref];
  if (!d) return false;
  if (!u) return true;
  return d >= u; // tombstone at-or-after the last update wins ties
}

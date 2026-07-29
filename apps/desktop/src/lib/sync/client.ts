import type { LedgerState } from "@/lib/ledger/types";
import * as db from "@/lib/db";
import { mergeLedgerStates, type Side } from "./merge";
import { encryptPayload, decryptPayload } from "./crypto";
import { loadSyncConfig, saveSyncConfig, authTokenFor, type SyncConfig } from "./account";
import { loadSyncMeta, saveSyncMeta } from "./meta-store";
import { emptySyncMeta, type SyncMeta, type SyncPayload } from "./types";

const MAX_PUSH_RETRIES = 3;

export type SyncResult =
  | { ok: true; state: LedgerState }
  | { ok: false; error: string };

type PullResponse = { version: number; blob: string | null };
type PushResponse = { ok: true; version: number } | { ok: false; version: number; blob: string | null };

async function httpPull(cfg: SyncConfig): Promise<PullResponse> {
  const token = await authTokenFor(cfg);
  const res = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}/v1/sync/pull?accountId=${encodeURIComponent(cfg.accountId!)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("Sync rejected this device's credentials — check the secret matches.");
  if (!res.ok) throw new Error(`Sync server error while pulling (${res.status})`);
  return res.json();
}

async function httpPush(cfg: SyncConfig, expectedVersion: number, blob: string): Promise<PushResponse> {
  const token = await authTokenFor(cfg);
  const res = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}/v1/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ accountId: cfg.accountId, expectedVersion, blob }),
  });
  if (res.status === 401) throw new Error("Sync rejected this device's credentials — check the secret matches.");
  if (res.status === 409) return { ok: false, ...(await res.json()) };
  if (!res.ok) throw new Error(`Sync server error while pushing (${res.status})`);
  return { ok: true, ...(await res.json()) };
}

function sideFromPayload(payload: SyncPayload | null): Side {
  if (!payload) {
    return { state: emptyLedgerState(), meta: emptySyncMeta() };
  }
  return { state: payload.state, meta: payload.meta };
}

function emptyLedgerState(): LedgerState {
  return {
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
}

/**
 * Runs one full sync cycle: pull the remote copy, merge it with this
 * device's current state, persist the merged result locally (via the
 * existing, unguarded `db.replaceLedger` — sync is infrastructure
 * reconciling state, not a local-user action, so it deliberately does NOT
 * go through store.tsx's write-permission gate the way UI-driven edits
 * do), then push the merged result back up.
 *
 * If the push loses a race (another device pushed in between this
 * device's pull and push), the server returns 409 with its newer blob;
 * this merges again against that and retries, bounded to
 * MAX_PUSH_RETRIES so a persistent conflict can't loop forever.
 */
export async function syncNow(localState: LedgerState): Promise<SyncResult> {
  const cfg = loadSyncConfig();
  if (!cfg.enabled || !cfg.secret || !cfg.accountId) {
    return { ok: false, error: "Sync is not enabled on this device." };
  }

  try {
    const localMeta = loadSyncMeta();
    const pulled = await httpPull(cfg);
    const remotePayload: SyncPayload | null = pulled.blob ? await decryptPayload(cfg.secret, pulled.blob) : null;
    let merged = mergeLedgerStates({ state: localState, meta: localMeta }, sideFromPayload(remotePayload));
    let expectedVersion = pulled.version;

    for (let attempt = 0; attempt < MAX_PUSH_RETRIES; attempt++) {
      const payload: SyncPayload = { state: merged.state, meta: merged.meta, packedAt: new Date().toISOString() };
      const blob = await encryptPayload(cfg.secret, payload);
      const pushed = await httpPush(cfg, expectedVersion, blob);

      if (pushed.ok) {
        await db.replaceLedger(merged.state);
        saveSyncMeta(merged.meta);
        const fresh = await db.selectLedgerState();
        saveSyncConfig({ ...cfg, lastVersion: pushed.version, lastSyncedAt: new Date().toISOString() });
        return { ok: true, state: fresh };
      }

      // 409 — someone else pushed since our pull. Merge against their
      // newer blob (which the server conveniently returned inline, no
      // extra round trip) and try again.
      const theirPayload: SyncPayload | null = pushed.blob ? await decryptPayload(cfg.secret, pushed.blob) : null;
      merged = mergeLedgerStates(merged, sideFromPayload(theirPayload));
      expectedVersion = pushed.version;
    }

    return { ok: false, error: "Sync kept losing the race with another device — try again shortly." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown sync error" };
  }
}

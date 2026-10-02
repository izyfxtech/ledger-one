import { createStore } from "@tanstack/react-store";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as db from "@/lib/db";
import { queryClient } from "@/lib/query-client";
import { supabase } from "@/lib/cloud/client";
import { ledgerKey } from "@/lib/ledger/query";
import type { LedgerState } from "@/lib/ledger/types";
import { runSyncCycle, type SyncOutcome } from "./engine";
import { outbox } from "./outbox-instance";
import { supabaseRemote, type Remote } from "./remote";
import { syncHooks } from "./signals";

export type SyncPhase = "off" | "idle" | "syncing" | "offline" | "error";

/** What the UI shows about sync. */
export const syncStore = createStore({
  phase: "off" as SyncPhase,
  lastSyncedAt: null as string | null,
  error: null as string | null,
  /** Local changes not yet in the cloud. */
  pending: 0,
});

const set = (patch: Partial<ReturnType<typeof syncStore.get>>) =>
  syncStore.setState((s) => ({ ...s, ...patch }));

const OWNER_KEY = "cloud_owner";
const PERIODIC_MS = 60_000;
const LOCAL_CHANGE_DEBOUNCE_MS = 2_000;

let session: {
  uid: string;
  remote: Remote;
  channel?: RealtimeChannel;
  interval?: number;
  cleanup: Array<() => void>;
} | null = null;
let running: Promise<SyncOutcome> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export class OtherAccountDataError extends Error {
  constructor(public pending: number) {
    super(
      `This device still has ${pending} unsynced change${pending === 1 ? "" : "s"} from a different account. Sign in with that account to sync them first, or erase this device's data.`,
    );
    this.name = "OtherAccountDataError";
  }
}

const waitForIdle = async () => {
  for (let i = 0; i < 200 && queryClient.isMutating() > 0; i++)
    await new Promise((r) => setTimeout(r, 25));
};

export const ledgerHasContent = (s: LedgerState) =>
  s.objects.length +
    s.transactions.length +
    s.categories.length +
    s.goals.length +
    s.budgets.length +
    s.allocations.length >
    0 ||
  s.domains.some((d) => d.id !== "personal") ||
  s.fx.length > 0;

/** Remove everything that ties this device's data to an account. */
async function clearCloudBookkeeping(uid: string | null) {
  await db.setSetting(OWNER_KEY, null);
  if (uid) {
    await db.setSetting(`sync_outbox:${uid}`, null);
    await db.setSetting(`sync_cursor:${uid}`, null);
  }
}

/** Erase this device's copy of the data (used when switching accounts or
 *  signing out). Does not touch the cloud. */
export async function eraseLocalData(): Promise<void> {
  const owner = (await db.getSetting(OWNER_KEY)) as string | null;
  await stopCloudSession();
  await db.resetWorkspace();
  await clearCloudBookkeeping(owner);
  await queryClient.invalidateQueries({ queryKey: ledgerKey });
}

/**
 * Begin syncing for `uid`. Safe to call on every launch.
 *  - Data from a DIFFERENT account never mixes in: it is refused if it has
 *    unsynced changes, otherwise cleared.
 *  - The first time an account is linked on a device that already holds data,
 *    that data is adopted: anything not in the cloud is uploaded, and the
 *    cloud wins any conflict.
 */
export async function startCloudSession(uid: string): Promise<void> {
  if (session?.uid === uid) return;
  await stopCloudSession();

  const owner = (await db.getSetting(OWNER_KEY)) as string | null;
  let firstLink = false;
  if (owner && owner !== uid) {
    await outbox.activate(owner);
    if (outbox.size > 0) {
      const n = outbox.size;
      outbox.deactivate();
      throw new OtherAccountDataError(n);
    }
    await db.resetWorkspace();
    await clearCloudBookkeeping(owner);
    firstLink = true;
  } else if (!owner) {
    firstLink = true;
  }

  await outbox.activate(uid);
  if (firstLink) {
    outbox.adoptAll(await db.selectLedgerState());
    await outbox.flush();
    await db.setSetting(OWNER_KEY, uid);
  }

  const client = supabase();
  const s: NonNullable<typeof session> = { uid, remote: supabaseRemote(client), cleanup: [] };
  session = s;

  // Other devices changed something → pull soon.
  s.channel = client
    .channel(`ledger-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ledger_entities", filter: `user_id=eq.${uid}` },
      () => requestSync(500),
    )
    .subscribe();

  const onOnline = () => requestSync(0);
  const onVisible = () => document.visibilityState === "visible" && requestSync(0);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  s.cleanup.push(
    () => window.removeEventListener("online", onOnline),
    () => document.removeEventListener("visibilitychange", onVisible),
  );
  s.interval = window.setInterval(() => requestSync(0), PERIODIC_MS);

  syncHooks.onLocalChange = () => {
    set({ pending: outbox.size });
    requestSync(LOCAL_CHANGE_DEBOUNCE_MS);
  };
  set({ phase: "idle", error: null, pending: outbox.size });
}

export async function stopCloudSession(): Promise<void> {
  const s = session;
  session = null;
  clearTimeout(timer);
  syncHooks.onLocalChange = () => {};
  if (s) {
    s.cleanup.forEach((f) => f());
    if (s.interval) clearInterval(s.interval);
    if (s.channel) void supabase().removeChannel(s.channel);
  }
  outbox.deactivate();
  set({ phase: "off", error: null, pending: 0 });
}

/** Ask for a sync soon; bursts of calls collapse into one. */
export function requestSync(delayMs = 0) {
  if (!session) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}

/** Run one sync cycle now. Concurrent calls share the running one; a request
 *  that arrives mid-run triggers one more pass afterwards. */
export async function syncNow(): Promise<SyncOutcome> {
  const s = session;
  if (!s) return { ok: false, error: "Not signed in", offline: false };
  if (running) {
    again = true;
    return running;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    set({ phase: "offline" });
    return { ok: false, error: "Offline", offline: true };
  }

  set({ phase: "syncing", error: null });
  running = (async () => {
    const result = await runSyncCycle({ db, outbox, remote: s.remote, uid: s.uid, waitForIdle });
    if (session !== s) return result; // signed out mid-sync
    if (result.ok) {
      set({ phase: "idle", lastSyncedAt: new Date().toISOString(), pending: outbox.size });
      if (result.applied > 0) await queryClient.invalidateQueries({ queryKey: ledgerKey });
    } else {
      set({
        phase: result.offline ? "offline" : "error",
        error: result.offline ? null : result.error,
        pending: outbox.size,
      });
    }
    return result;
  })();
  try {
    return await running;
  } finally {
    running = null;
    if (again) {
      again = false;
      requestSync(0);
    }
  }
}

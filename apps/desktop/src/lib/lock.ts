import { createStore } from "@tanstack/react-store";
import { queryClient } from "@/lib/query-client";
import { securityQuery } from "@/lib/app-queries";

// PIN lock state machine. Lives in a Store (not component state) so the idle
// timer and activity listeners are installed exactly once, with no effect
// bookkeeping, and the lock survives any remount of the UI above it.

export type LockPhase = "checking" | "locked" | "unlocked";

export const lockStore = createStore({
  phase: "checking" as LockPhase,
  lastActivity: Date.now(),
});

export const lock = {
  lock: () => lockStore.setState((s) => ({ ...s, phase: "locked" })),
  unlock: () => lockStore.setState(() => ({ phase: "unlocked", lastActivity: Date.now() })),
  touch: () => lockStore.setState((s) => ({ ...s, lastActivity: Date.now() })),
};

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "touchstart", "wheel"] as const;
let installed = false;

/** Resolve the initial phase from stored security config (once), then watch
 *  activity and auto-lock when idle. Call from the root route loader. */
export async function initLock() {
  const cfg = await queryClient.ensureQueryData(securityQuery);
  if (lockStore.get().phase === "checking") {
    lockStore.setState((s) => ({
      ...s,
      phase: cfg.pinHash && cfg.lockOnStart ? "locked" : "unlocked",
    }));
  }
  if (installed) return;
  installed = true;

  // Throttled: at most one store write per second.
  let last = 0;
  const bump = () => {
    const now = Date.now();
    if (now - last < 1000) return;
    last = now;
    lock.touch();
  };
  for (const e of ACTIVITY_EVENTS) window.addEventListener(e, bump, { passive: true });

  window.setInterval(() => {
    const cur = queryClient.getQueryData(securityQuery.queryKey);
    const { phase, lastActivity } = lockStore.get();
    if (!cur?.pinHash || cur.autoLockMinutes <= 0 || phase !== "unlocked") return;
    if (Date.now() - lastActivity >= cur.autoLockMinutes * 60_000) lock.lock();
  }, 5000);
}

// ---------- wrong-PIN throttling ----------
// A 4-digit PIN has only 10,000 combinations, so the prompt must not accept
// guesses at full speed. After FREE_ATTEMPTS wrong tries in a row, each further
// failure doubles the wait (30s, 60s, ... capped at 15 min). In-memory by design:
// it resets on a successful unlock or an app restart. This only slows the
// on-screen prompt; it is not a defence against someone reading the database
// file directly (the PIN hash is stored unencrypted).
export const FREE_ATTEMPTS = 5;
const MAX_LOCKOUT_S = 15 * 60;

export function lockoutSeconds(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(MAX_LOCKOUT_S, 30 * 2 ** (failures - FREE_ATTEMPTS));
}

const attempts = { failures: 0, until: 0 };

export const pinAttempts = {
  /** Milliseconds until another guess is allowed (0 = allowed now). */
  remainingMs: (now = Date.now()) => Math.max(0, attempts.until - now),
  recordFailure(now = Date.now()) {
    attempts.failures += 1;
    attempts.until = now + lockoutSeconds(attempts.failures) * 1000;
  },
  recordSuccess() {
    attempts.failures = 0;
    attempts.until = 0;
  },
  reset() {
    attempts.failures = 0;
    attempts.until = 0;
  },
};

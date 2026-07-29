import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loadSecurity, verifyPin, type SecurityConfig } from "@/lib/local-store";
import { BOOT_TIME } from "@/lib/boot-time";

const MIN_SPLASH_MS = 1200;

// Full-screen lock overlay. Mounts inside <App /> so it can gate every route.
// - Locks on first load when `lockOnStart` is enabled.
// - Locks after `autoLockMinutes` of inactivity when > 0.
// - Unlocks via PIN verification (SHA-256 against per-device salt).
//
// Security config now lives in SQLite (see @/lib/local-store), which means
// reading it is async. We don't render `children` at all until that first
// read resolves ("checking" phase) — rendering them optimistically and
// only showing the overlay once the fetch comes back would flash real
// workspace content for a moment on every boot where lockOnStart is set.

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "touchstart", "wheel"] as const;

type Phase = "checking" | "locked" | "unlocked";

export function LockGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [cfg, setCfg] = useState<SecurityConfig | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const lastActivity = useRef<number>(Date.now());

  const applyConfig = (c: SecurityConfig) => {
    setCfg(c);
    setPhase(c.pinHash && c.lockOnStart ? "locked" : "unlocked");
  };

  useEffect(() => {
    let cancelled = false;
    loadSecurity().then((c) => {
      if (!cancelled) applyConfig(c);
    });
    const onChange = () => {
      loadSecurity().then((c) => {
        if (!cancelled) setCfg(c); // config changed elsewhere; don't re-lock a session already unlocked
      });
    };
    window.addEventListener("ledgerone:security-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("ledgerone:security-changed", onChange);
    };
  }, []);

  // Track activity for auto-lock timer.
  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bump));
    };
  }, []);

  useEffect(() => {
    if (!cfg?.pinHash || cfg.autoLockMinutes <= 0 || phase === "locked") return;
    const iv = window.setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      if (idleMs >= cfg.autoLockMinutes * 60 * 1000) setPhase("locked");
    }, 5000);
    return () => window.clearInterval(iv);
  }, [cfg?.autoLockMinutes, cfg?.pinHash, phase]);

  useEffect(() => {
    if (phase === "checking") return;
    const elapsed = Date.now() - BOOT_TIME;
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
    const t = window.setTimeout(() => {
      invoke("close_splashscreen").catch((err) => {
        console.error("[lock-gate] close_splashscreen failed (safety-net timer will cover it):", err);
      });
    }, wait);
    return () => window.clearTimeout(t);
  }, [phase]);

  const onUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const ok = await verifyPin(pin);
    if (ok) {
      setPin("");
      setPhase("unlocked");
      lastActivity.current = Date.now();
    } else {
      setErr("Incorrect PIN");
    }
  };

  if (phase === "checking") {
    // Neutral, empty screen — no workspace content, no PIN form (we don't
    // yet know if one is even needed) — until we know the real lock state.
    return <div className="h-full bg-background" />;
  }

  return (
    <>
      {children}
      {phase === "locked" && cfg?.pinHash && (
        <div className="fixed inset-x-0 bottom-0 top-[34px] z-[9999] bg-background/95 backdrop-blur flex items-center justify-center px-4">
          <form onSubmit={onUnlock} className="w-full max-w-sm text-center space-y-5">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Workspace locked</div>
              <h2 className="mt-2 text-xl font-semibold">Enter PIN to continue</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your data stays on this device.</p>
            </div>
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setErr(null); }}
              placeholder="••••"
              className="text-center text-lg tracking-widest"
            />
            {err && <div className="text-sm text-destructive">{err}</div>}
            <Button type="submit" className="w-full">Unlock</Button>
          </form>
        </div>
      )}
    </>
  );
}

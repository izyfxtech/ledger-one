// Small local-only stores. Security (PIN lock), onboarding-complete, and
// tour-complete all live in SQLite (settings table) rather than
// localStorage. All three gate access to, or represent the freshness of,
// the workspace itself — they need to live and die with that data.
// localStorage in a Tauri WebView survives an uninstall/reinstall (and,
// independently, a "Reset workspace") which silently defeated all three:
// a stale PIN kept gating data it was never set for, and a stale
// onboarding-complete flag meant a freshly reset/reseeded workspace would
// silently skip onboarding and just show the demo seed data untouched.
// Users & Permissions and display name are genuinely device-local
// preferences (who's using this computer, not what's in the ledger) and
// stay in localStorage.
import { getSetting, setSetting } from "@/lib/db";
import { toast } from "sonner";

const has = () => typeof window !== "undefined";

// ---------- Security / PIN lock ----------

const SEC_SETTING_KEY = "security_config";

export type SecurityConfig = {
  pinHash: string | null;      // SHA-256 hex of `${salt}:${pin}`, null when unset
  salt: string | null;
  lockOnStart: boolean;
  autoLockMinutes: number;     // 0 = never
  updatedAt: string;
};

const DEFAULT_SECURITY: SecurityConfig = {
  pinHash: null,
  salt: null,
  lockOnStart: false,
  autoLockMinutes: 0,
  updatedAt: new Date(0).toISOString(),
};

export async function loadSecurity(): Promise<SecurityConfig> {
  try {
    const raw = await getSetting(SEC_SETTING_KEY);
    if (!raw || typeof raw !== "object") return DEFAULT_SECURITY;
    return { ...DEFAULT_SECURITY, ...(raw as Partial<SecurityConfig>) };
  } catch (err) {
    console.error("[security] loadSecurity failed:", err);
    return DEFAULT_SECURITY;
  }
}

export async function saveSecurity(cfg: SecurityConfig) {
  if (!canPerform("admin")) {
    const msg = "Only admins can change security settings.";
    toast.error(msg);
    throw new Error(msg);
  }
  await setSetting(SEC_SETTING_KEY, cfg);
  if (has()) window.dispatchEvent(new CustomEvent("ledgerone:security-changed"));
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setPin(pin: string, opts: Partial<Omit<SecurityConfig, "pinHash" | "salt" | "updatedAt">> = {}) {
  const cfg = await loadSecurity();
  const salt = cfg.salt ?? randomSalt();
  const pinHash = await hashPin(pin, salt);
  await saveSecurity({
    ...cfg,
    ...opts,
    salt,
    pinHash,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearPin() {
  const cfg = await loadSecurity();
  await saveSecurity({
    ...cfg,
    pinHash: null,
    salt: null,
    lockOnStart: false,
    autoLockMinutes: 0,
    updatedAt: new Date().toISOString(),
  });
}

export async function verifyPin(pin: string): Promise<boolean> {
  const cfg = await loadSecurity();
  if (!cfg.pinHash || !cfg.salt) return true;
  const hash = await hashPin(pin, cfg.salt);
  return hash === cfg.pinHash;
}

// ---------- Users & Permissions ----------

const USERS_KEY = "ledgerone.users.v1";
const ACTIVE_USER_KEY = "ledgerone.activeUser.v1";

export type UserRole = "admin" | "editor" | "viewer";

export type LocalUser = {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  createdAt: string;
};

export function loadUsers(): LocalUser[] {
  if (!has()) return [];
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) return defaultUsers();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultUsers();
    return parsed as LocalUser[];
  } catch {
    return defaultUsers();
  }
}

function defaultUsers(): LocalUser[] {
  return [
    {
      id: "user_owner",
      name: "Workspace Owner",
      role: "admin",
      createdAt: new Date().toISOString(),
    },
  ];
}

export function saveUsers(users: LocalUser[]) {
  if (!has()) return;
  if (!canPerform("admin")) {
    const msg = "Only admins can manage users and roles.";
    toast.error(msg);
    throw new Error(msg);
  }
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  window.dispatchEvent(new CustomEvent("ledgerone:users-changed"));
}

export function getActiveUserId(): string | null {
  if (!has()) return null;
  return window.localStorage.getItem(ACTIVE_USER_KEY);
}

/** Low-level setter — no permission check. Only `activateUser()` below
 *  should call this from UI code; it exists on its own mainly so
 *  `activateUser()` has something to call once it's satisfied itself the
 *  switch is allowed. */
function setActiveUserId(id: string | null) {
  if (!has()) return;
  if (id == null) window.localStorage.removeItem(ACTIVE_USER_KEY);
  else window.localStorage.setItem(ACTIVE_USER_KEY, id);
  window.dispatchEvent(new CustomEvent("ledgerone:users-changed"));
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, editor: 1, admin: 2 };

export type ActivateUserResult =
  | { ok: true }
  | { ok: false; reason: "pin-required" | "pin-incorrect" };

/**
 * Switch which local user is active on this device.
 *
 * Stepping DOWN (or sideways) to a same-or-lesser-privileged identity is
 * always free — that's the normal "hand the device to someone else"
 * flow. Stepping UP to a more-privileged identity than the one currently
 * active is where the actual security boundary has to live: previously
 * this was a bare `setActiveUserId(id)` with no check at all, which meant
 * a Viewer could simply click "Set active" on the Admin row in Settings
 * and instantly inherit full admin access — the entire Users &
 * Permissions role model was cosmetic. Every other admin-gated action in
 * this file (saveUsers, saveSecurity) already throws for a non-admin
 * *actor*, but "which user am I" isn't an action the current actor takes
 * on data — it's a change of identity, so it has to be checked against a
 * credential, not a permission.
 *
 * The only credential this app has is the device-wide PIN (there's no
 * per-user password — these are local, organizational profiles on a
 * single shared device, not accounts). So: if a PIN is configured,
 * stepping up requires it. If no PIN is configured, there's no
 * credential to check against — same as LockGate not locking without one
 * — so the switch is allowed, matching how every other PIN-gated
 * behavior in this app already degrades when no PIN exists.
 */
export async function activateUser(
  id: string,
  opts: { pin?: string } = {},
): Promise<ActivateUserResult> {
  const users = loadUsers();
  const target = users.find((u) => u.id === id);
  if (!target) return { ok: true }; // caller passed a bogus id; nothing to protect

  const currentId = getActiveUserId();
  const current = users.find((u) => u.id === currentId) ?? users[0];
  const steppingUp = !current || ROLE_RANK[target.role] > ROLE_RANK[current.role];

  if (steppingUp) {
    const cfg = await loadSecurity();
    if (cfg.pinHash) {
      if (opts.pin == null) return { ok: false, reason: "pin-required" };
      const ok = await verifyPin(opts.pin);
      if (!ok) return { ok: false, reason: "pin-incorrect" };
    }
  }

  setActiveUserId(id);
  return { ok: true };
}

/** The role of whoever is currently active on this device. Falls back to
 *  "admin" if there's no resolvable active user — defaultUsers() always
 *  provides at least one, so this only matters in a genuinely broken
 *  localStorage state, and failing open (rather than locking everyone out)
 *  is the safer default for a single-device, no-recovery-flow app. */
export function activeRole(): UserRole {
  const users = loadUsers();
  const activeId = getActiveUserId();
  const active = users.find((u) => u.id === activeId) ?? users[0];
  return active?.role ?? "admin";
}

/**
 * Permission check used to actually enforce the roles the Users &
 * Permissions UI lets you assign (previously roles were purely
 * organizational — nothing checked them before allowing a change).
 *   - "write": ledger data changes (transactions, accounts, domains,
 *     allocations, goals, budgets, fx rates) — admin and editor.
 *   - "admin": workspace-level actions (settings, import, restore, reset,
 *     security PIN, managing other users) — admin only.
 */
export function canPerform(action: "write" | "admin"): boolean {
  const role = activeRole();
  if (action === "admin") return role === "admin";
  return role !== "viewer";
}

// ---------- Display name (what the app calls the user) ----------

const NAME_KEY = "ledgerone.displayName.v1";

export function loadDisplayName(): string {
  if (!has()) return "";
  return window.localStorage.getItem(NAME_KEY) ?? "";
}

export function saveDisplayName(name: string) {
  if (!has()) return;
  const v = name.trim();
  if (v) window.localStorage.setItem(NAME_KEY, v);
  else window.localStorage.removeItem(NAME_KEY);
  window.dispatchEvent(new CustomEvent("ledgerone:display-name-changed"));
}

// ---------- Tour ----------

const TOUR_SETTING_KEY = "tour_state";

export type TourState = { complete: boolean; completedAt: string | null };

// Default to COMPLETE so the tour never fires unless explicitly started
// (via `startTour()` at the end of onboarding, or Data Management → Restart tour).
const DEFAULT_TOUR: TourState = { complete: true, completedAt: null };

export async function loadTour(): Promise<TourState> {
  try {
    const raw = await getSetting(TOUR_SETTING_KEY);
    if (!raw || typeof raw !== "object") return DEFAULT_TOUR;
    return { ...DEFAULT_TOUR, ...(raw as Partial<TourState>) };
  } catch (err) {
    console.error("[tour] loadTour failed:", err);
    return DEFAULT_TOUR;
  }
}

export async function setTourComplete() {
  await setSetting(TOUR_SETTING_KEY, { complete: true, completedAt: new Date().toISOString() } satisfies TourState);
  if (has()) window.dispatchEvent(new CustomEvent("ledgerone:tour-changed"));
}

export async function startTour() {
  await setSetting(TOUR_SETTING_KEY, { complete: false, completedAt: null } satisfies TourState);
  if (has()) window.dispatchEvent(new CustomEvent("ledgerone:tour-changed"));
}

// ---------- Onboarding ----------

const ONBOARDING_SETTING_KEY = "onboarding_state";

export type OnboardingState = { complete: boolean; completedAt: string | null };

const DEFAULT_ONBOARDING: OnboardingState = { complete: false, completedAt: null };

export async function loadOnboarding(): Promise<OnboardingState> {
  try {
    const raw = await getSetting(ONBOARDING_SETTING_KEY);
    if (!raw || typeof raw !== "object") return DEFAULT_ONBOARDING;
    return { ...DEFAULT_ONBOARDING, ...(raw as Partial<OnboardingState>) };
  } catch (err) {
    console.error("[onboarding] loadOnboarding failed:", err);
    return DEFAULT_ONBOARDING;
  }
}

export async function setOnboardingComplete() {
  await setSetting(ONBOARDING_SETTING_KEY, { complete: true, completedAt: new Date().toISOString() } satisfies OnboardingState);
  if (has()) window.dispatchEvent(new CustomEvent("ledgerone:onboarding-changed"));
}

export async function resetOnboarding() {
  await setSetting(ONBOARDING_SETTING_KEY, { complete: false, completedAt: null } satisfies OnboardingState);
  if (has()) window.dispatchEvent(new CustomEvent("ledgerone:onboarding-changed"));
}

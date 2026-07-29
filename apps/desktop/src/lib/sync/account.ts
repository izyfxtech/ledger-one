// Where "is sync turned on, and with what credentials" lives. Same
// localStorage trust boundary as the device PIN hash and Users &
// Permissions (see local-store.ts) — on a machine where someone already
// has filesystem access, they already have the entire plaintext ledger in
// SQLite, so storing the sync secret in localStorage doesn't lower the
// bar any further. What the secret actually protects is the copy in
// transit and at rest on the server, not the local copy.
import { generateSyncSecret, deriveAccountId, deriveAuthToken } from "./crypto";

const has = () => typeof window !== "undefined";
const CONFIG_KEY = "ledgerone.sync.v1";

export type SyncConfig = {
  enabled: boolean;
  serverUrl: string;
  secret: string | null;
  accountId: string | null;
  /** The blob version this device last successfully pushed or pulled —
   *  the optimistic-concurrency cursor the server checks pushes against. */
  lastVersion: number;
  lastSyncedAt: string | null;
};

const DEFAULT_CONFIG: SyncConfig = {
  enabled: false,
  serverUrl: "",
  secret: null,
  accountId: null,
  lastVersion: 0,
  lastSyncedAt: null,
};

export function loadSyncConfig(): SyncConfig {
  if (!has()) return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveSyncConfig(cfg: SyncConfig) {
  if (!has()) return;
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent("ledgerone:sync-config-changed"));
}

/** Turns sync on for the first time on this device: generates a brand
 *  new secret, derives its account id, and saves it as enabled. The
 *  caller is responsible for showing the secret to the user once — it
 *  cannot be recovered from anywhere after this (see crypto.ts's header
 *  comment on why there's deliberately no reset flow). */
export async function enableNewSyncAccount(serverUrl: string): Promise<SyncConfig> {
  const secret = generateSyncSecret();
  const accountId = await deriveAccountId(secret);
  const cfg: SyncConfig = {
    enabled: true,
    serverUrl,
    secret,
    accountId,
    lastVersion: 0,
    lastSyncedAt: null,
  };
  saveSyncConfig(cfg);
  return cfg;
}

/** Turns sync on using a secret copied from another device that already
 *  has an account — this is how a second device joins the same synced
 *  workspace. Doesn't touch local data by itself; the caller still needs
 *  to run a sync to actually pull the remote copy down. */
export async function linkExistingSyncAccount(serverUrl: string, secret: string): Promise<SyncConfig> {
  const accountId = await deriveAccountId(secret);
  const cfg: SyncConfig = {
    enabled: true,
    serverUrl,
    secret,
    accountId,
    lastVersion: 0,
    lastSyncedAt: null,
  };
  saveSyncConfig(cfg);
  return cfg;
}

/** Turns sync off. Deliberately does NOT delete the account server-side
 *  or clear the secret from this call alone — disabling sync on one
 *  device shouldn't affect any other linked device or the server copy.
 *  Forgetting the secret locally (so this device could no longer rejoin
 *  without re-entering it) is a separate, explicit action in the UI. */
export function disableSync() {
  const cfg = loadSyncConfig();
  saveSyncConfig({ ...cfg, enabled: false });
}

export async function authTokenFor(cfg: SyncConfig): Promise<string> {
  if (!cfg.secret) throw new Error("Sync is not configured on this device");
  return deriveAuthToken(cfg.secret);
}

/** A short, human-comparable fingerprint of the account — not a secret,
 *  just enough of the accountId to eyeball-compare between two devices
 *  after linking. A mistyped secret derives a *different*, valid-looking
 *  account rather than an error (see sync-client.test.ts), so this is the
 *  practical way to catch that: if two devices don't show the same
 *  fingerprint, they aren't actually sharing a ledger yet. */
export function accountFingerprint(accountId: string | null): string {
  if (!accountId) return "—";
  return accountId.slice(0, 4).toUpperCase() + "-" + accountId.slice(4, 8).toUpperCase();
}

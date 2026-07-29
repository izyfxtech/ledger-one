// Named, in-app backup snapshots — a quick-rollback convenience feature
// distinct from the ledger's real persistence (SQLite). Stored in
// localStorage, which is a normal, supported store for a Tauri WebView;
// this isn't a web-preview fallback, it's a deliberate feature so users can
// snapshot/restore without leaving the app. Full export/import to a file on
// disk is the durable backup path (see Settings' "Export").

import type { LedgerState } from "@/lib/ledger/types";
import { LEDGER_SCHEMA_VERSION } from "@/lib/ledger/schema";

const BACKUPS_KEY = "ledgerone.backups.v1";

export type BackupRecord = {
  id: string;
  name: string;
  createdAt: string; // ISO
  size: number;      // bytes of the serialized state
  version: number;
  state: LedgerState;
};

type StoredBackups = BackupRecord[];

function readBackups(): StoredBackups {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BACKUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredBackups;
  } catch {
    return [];
  }
}

function writeBackups(rows: StoredBackups) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BACKUPS_KEY, JSON.stringify(rows));
}

export function listBackups(): BackupRecord[] {
  return readBackups().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function createBackup(name: string, state: LedgerState): BackupRecord {
  const serialized = JSON.stringify(state);
  const record: BackupRecord = {
    id: `bak_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || `Snapshot ${new Date().toLocaleString()}`,
    createdAt: new Date().toISOString(),
    size: serialized.length,
    version: LEDGER_SCHEMA_VERSION,
    state,
  };
  const rows = readBackups();
  rows.push(record);
  writeBackups(rows);
  return record;
}

export function deleteBackup(id: string) {
  writeBackups(readBackups().filter((r) => r.id !== id));
}

export function restoreBackup(id: string): LedgerState | null {
  const found = readBackups().find((r) => r.id === id);
  return found ? found.state : null;
}

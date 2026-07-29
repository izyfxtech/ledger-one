import Database from "better-sqlite3";
import { createHash } from "node:crypto";

// The server never sees the sync secret or the plaintext ledger — only
// what the client already derived and encrypted client-side (see
// apps/desktop/src/lib/sync/crypto.ts). `auth_token_hash` is a further
// SHA-256 of the already-derived authToken, so even a full database leak
// doesn't hand an attacker anything usable to authenticate as an account
// — they'd need the original authToken, which itself isn't the secret.

export type SyncRow = {
  accountId: string;
  version: number;
  blob: string | null;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class SyncStore {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_blobs (
        account_id      TEXT PRIMARY KEY,
        auth_token_hash TEXT NOT NULL,
        version         INTEGER NOT NULL DEFAULT 0,
        blob            TEXT,
        updated_at      TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  private get(accountId: string): { authTokenHash: string; version: number; blob: string | null } | undefined {
    return this.db
      .prepare("SELECT auth_token_hash as authTokenHash, version, blob FROM sync_blobs WHERE account_id = ?")
      .get(accountId) as any;
  }

  /** Returns the account's current row, auto-provisioning it (bound to
   *  whichever authToken hash is presented) on first contact — there's no
   *  separate "create account" step; the first push or pull for a
   *  never-seen accountId establishes it. Returns `{authorized: false}`
   *  if the account exists but the presented token doesn't match. */
  pull(accountId: string, authTokenHash: string): { authorized: true; version: number; blob: string | null } | { authorized: false } {
    let row = this.get(accountId);
    if (!row) {
      const now = new Date().toISOString();
      this.db
        .prepare("INSERT INTO sync_blobs (account_id, auth_token_hash, version, blob, updated_at) VALUES (?, ?, 0, NULL, ?)")
        .run(accountId, authTokenHash, now);
      row = { authTokenHash, version: 0, blob: null };
    }
    if (row.authTokenHash !== authTokenHash) return { authorized: false };
    return { authorized: true, version: row.version, blob: row.blob };
  }

  /** Optimistic-concurrency push: succeeds only if `expectedVersion`
   *  matches the row's current version (or the row doesn't exist yet, in
   *  which case any expectedVersion of 0 succeeds and creates it). On a
   *  version mismatch, returns the row's actual current state instead of
   *  just an error, so the caller can merge and retry without a second
   *  round trip. */
  push(
    accountId: string,
    authTokenHash: string,
    expectedVersion: number,
    blob: string,
  ):
    | { authorized: false }
    | { authorized: true; ok: true; version: number }
    | { authorized: true; ok: false; version: number; blob: string | null } {
    const row = this.get(accountId);
    const now = new Date().toISOString();

    if (!row) {
      if (expectedVersion !== 0) {
        // Client thought there was existing history; there wasn't.
        return { authorized: true, ok: false, version: 0, blob: null };
      }
      this.db
        .prepare("INSERT INTO sync_blobs (account_id, auth_token_hash, version, blob, updated_at) VALUES (?, ?, 1, ?, ?)")
        .run(accountId, authTokenHash, blob, now);
      return { authorized: true, ok: true, version: 1 };
    }

    if (row.authTokenHash !== authTokenHash) return { authorized: false };
    if (row.version !== expectedVersion) {
      return { authorized: true, ok: false, version: row.version, blob: row.blob };
    }

    const nextVersion = row.version + 1;
    this.db
      .prepare("UPDATE sync_blobs SET version = ?, blob = ?, updated_at = ? WHERE account_id = ?")
      .run(nextVersion, blob, now, accountId);
    return { authorized: true, ok: true, version: nextVersion };
  }
}

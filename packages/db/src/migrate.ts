// Node-side migration runner. Consumed by:
//   * the desktop app's Vitest suite (via mockTauriSql -> runMigrations)
//   * local dev scripting (`pnpm --filter @ledgerone/db run migrate:dev ./ledger.dev.db`)
//
// NEVER imported by the shipped frontend or by Rust. It depends on
// better-sqlite3, a native Node addon that cannot run inside the Tauri
// webview. The Rust side re-executes the exact same SQL files via
// `include_str!` (see src-tauri/src/main.rs).
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MIGRATION_FILES } from "./migrations";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(HERE, "..", "drizzle");

export function migrationSql(file: string): string {
  return readFileSync(join(DRIZZLE_DIR, file), "utf8");
}

export interface MigrateOptions {
  /** Skip creating __migrations bookkeeping (useful for fresh in-memory DBs). */
  skipBookkeeping?: boolean;
}

/**
 * Apply every migration in `MIGRATION_FILES` that has not yet been applied
 * to `db`. Idempotent: safe to call repeatedly.
 */
export function runMigrations(
  db: Database.Database,
  opts: MigrateOptions = {},
): void {
  db.pragma("foreign_keys = ON");

  if (!opts.skipBookkeeping) {
    db.exec(`CREATE TABLE IF NOT EXISTS __migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`);
  }

  const isApplied = opts.skipBookkeeping
    ? () => false
    : (name: string) =>
        !!db
          .prepare("SELECT 1 FROM __migrations WHERE name = ?")
          .get(name);

  const markApplied = opts.skipBookkeeping
    ? () => {}
    : (name: string) =>
        db
          .prepare("INSERT INTO __migrations(name, applied_at) VALUES (?, ?)")
          .run(name, Date.now());

  for (const file of MIGRATION_FILES) {
    if (isApplied(file)) continue;
    const sql = migrationSql(file);
    db.transaction(() => {
      db.exec(sql);
      markApplied(file);
    })();
  }
}

// CLI: `pnpm --filter @ledgerone/db exec tsx src/migrate.ts <path-to-db>`
if (import.meta.main) {
  const target = process.argv[2] ?? "./ledger.dev.db";
  const db = new Database(target);
  runMigrations(db);
  const rows = db.prepare("SELECT name FROM __migrations").all();
  console.log(`Applied ${rows.length} migration(s) to ${target}`);
  db.close();
}

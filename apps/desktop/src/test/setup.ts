// Vitest bootstrap. Individual test files mock @tauri-apps/api/core's
// invoke() themselves (see queries.test.ts) since the right mock behavior
// varies per test — there's no longer a single shared backend mock the
// way mockTauriSql.ts was for @tauri-apps/plugin-sql (removed along with
// that plugin; the database is now Rust-owned, see src-tauri/src/db.rs).
export {};

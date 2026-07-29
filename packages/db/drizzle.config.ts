import type { Config } from "drizzle-kit";

// The shipped desktop binary and the Node-side test/dev runner both execute
// the SAME SQL files under `drizzle/`. Drizzle-kit's `sqlite` dialect emits
// plain SQLite-compatible DDL — no libsql/Turso-specific syntax — so the same
// migrations run under Rust's rusqlite (Tauri, via include_str!) and
// better-sqlite3 (tests, dev).
export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;

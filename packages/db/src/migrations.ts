// Ordered list of migration filenames applied by BOTH the Node runner and
// the Rust plugin. The Rust side pulls the same names in the same order
// (see `MIGRATIONS` in src-tauri/src/db.rs). Add new migrations here in filename order,
// Files run in list order and each is recorded once, so a change to an
// already-applied file never re-runs: fix things with a NEW numbered file.
export const MIGRATION_FILES = [
  "0000_init.sql",
  "0001_domain_fields.sql",
  "triggers.sql",
  "0002_integrity_and_fx_precision.sql",
] as const;

export type MigrationFile = (typeof MIGRATION_FILES)[number];

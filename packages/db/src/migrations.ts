// Ordered list of migration filenames applied by BOTH the Node runner and
// the Rust plugin. The Rust side pulls the same names in the same order
// (see src-tauri/src/main.rs). Add new migrations here in filename order,
// and keep `triggers.sql` last.
export const MIGRATION_FILES = [
  "0000_init.sql",
  "0001_domain_fields.sql",
  "triggers.sql",
] as const;

export type MigrationFile = (typeof MIGRATION_FILES)[number];

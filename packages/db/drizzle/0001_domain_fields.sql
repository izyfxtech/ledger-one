-- The `Domain` TypeScript type (apps/desktop/src/lib/ledger/types.ts) and
-- the Domain Settings tab (components/domain-workspace.tsx) have long
-- supported an optional per-domain display currency and description, but
-- the `domains` table never had matching columns. Edits appeared to save
-- (in-memory state + the localStorage mirror both held them) but were
-- silently dropped by SQLite on the Tauri desktop shell, reverting on the
-- next app restart. This adds the missing columns.
ALTER TABLE domains ADD COLUMN display_currency TEXT;
ALTER TABLE domains ADD COLUMN description TEXT;

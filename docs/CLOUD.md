# Cloud sync (Supabase)

LedgerOne works on desktop and in the browser. Sign in and your ledger is saved
to your account and kept in sync between every device. Each device also keeps a
full local copy, so the app keeps working with no connection.

Cloud is **optional**: without the two settings below, the app is local-only
exactly as before (no sign-in screen).

## How it works

```
 desktop (Tauri)                        web (browser)
 ┌──────────────┐                       ┌──────────────┐
 │ React app    │                       │ React app    │   same code
 │ SQLite (rusqlite) ← local copy       │ IndexedDB    ← local copy
 └──────┬───────┘                       └──────┬───────┘
        │   push changed items / pull newer items
        └──────────────►  Supabase  ◄──────────┘
                          Auth + Postgres (RLS) + Realtime
```

* The app always reads and writes the **local** database. The UI never waits
  on the network.
* Every change is queued (the "outbox"). Sync pushes the queue, then pulls
  anything newer than the device's cursor. It runs after edits (debounced),
  when the app regains focus or connectivity, every minute, and when another
  device changes something (Realtime).
* Offline: edits are saved locally and queued; they upload when you reconnect.
  If you were signed in, the app opens and works offline from the cached data.
* Conflicts: last writer wins **per item** (a transaction, an account, …).
  Deletes are kept as tombstones so other devices learn about them.
* The cloud table is writable only through one function
  (`push_ledger_entities`), and Row Level Security limits every user to their
  own rows.

## Setup

1. **Create a Supabase project** (supabase.com).
2. **Create the tables.** In the SQL editor, run
   `supabase/migrations/20261001000000_ledger_sync.sql`
   (or `supabase db push` with the CLI).
3. **Auth settings** (Authentication → Providers → Email): decide whether new
   users must confirm their email. Under Authentication → URL Configuration set
   the **Site URL** to your deployed web app (confirmation links go there).
4. **Copy the keys** (Settings → API) into `apps/desktop/.env`
   (see `.env.example`):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
   Vite inlines these at build time, so set them for **both** the web build and
   the desktop installer build.
5. **Web:** `pnpm --filter desktop build:web` → upload `apps/desktop/dist-web`
   to any static host (Vercel, Netlify, Cloudflare Pages, …). Routing is
   hash-based; no rewrite rules are needed.
6. **Desktop:** `pnpm --filter desktop tauri:build` as before.

## Behaviour worth knowing

* **First sign-in on a device that already has local data:** that data is
  added to the account. Anything already in the cloud wins any conflict.
* **Signing in as a different account** on a device that still holds unsynced
  changes from another account is refused (with an option to erase the device).
* **Sign out** removes this device's copy of the data (it stays in the account).
* **Data at rest:** rows are stored as JSON in your Supabase Postgres,
  protected by RLS and Supabase's disk encryption, but readable by you (the
  project owner). It is *not* end-to-end encrypted. (The previous
  `packages/sync-server` design was; it is no longer used by the app.)
* **Workspace settings** (name, theme, density) sync with the account.
* **Not built yet:** in-app password reset, OAuth providers, per-account
  encryption passphrase.

## Testing

```
pnpm --filter desktop test                    # unit + simulated-browser tests
supabase/tests/run-local.sh                   # migration + RLS checks (needs local Postgres)
TEST_PG_URL=postgres://… pnpm --filter desktop test   # also runs the engine against that database
```

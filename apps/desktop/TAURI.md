# Building the Tauri desktop app

LedgerOne is a Tauri-only desktop app — there is no web/browser build. The
Vite + React app in `src/` is the frontend; the Rust shell lives in
`src-tauri/`. Everything runs offline. All ledger data lives in a SQLite
database that Rust opens and queries directly (`src-tauri/src/db.rs`, via
`rusqlite` — not a generic SQL plugin). The frontend calls typed commands
(`db_insert_transaction`, `db_select_ledger_state`, etc., see
`src/lib/db/queries.ts`); Rust owns the actual SQL. Schema + migrations are
authored in `packages/db/drizzle/` and embedded into the binary at compile
time (see `src-tauri/src/db.rs`'s `MIGRATIONS`).

## One-time setup (Linux)

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# WebKit / GTK system deps (Debian / Ubuntu 24.04+)
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Frontend deps (from the repo root — this is a pnpm workspace)
pnpm install
```

Generate icons once (any square PNG works):

```bash
pnpm dlx @tauri-apps/cli icon path/to/logo.png
```

## Window architecture

The main window starts hidden (`visible: false` in `tauri.conf.json`) and a
small frameless `splashscreen` window shows immediately instead. The
frontend calls the `close_splashscreen` command (see `src-tauri/src/main.rs`)
once `LockGate` resolves its first real render — i.e. once there's actual
content to show, not just a blank frame — which shows the main window and
closes the splash. A Rust-side timer force-shows the main window after 8s
regardless, so a stalled/broken frontend boot can't leave the user stuck on
the splash forever.

The main window itself is frameless (`decorations: false`); the titlebar
you see (`src/components/titlebar.tsx`) is drawn by the app itself so it can
follow the app's own light/dark theme instead of the OS's. Dragging and
minimize/maximize/close all go through `data-tauri-drag-region` and the
`@tauri-apps/api/window` JS API — no native window chrome is used on Linux.

## Develop

```bash
pnpm run tauri dev
```

This launches Vite on `http://localhost:8080` and opens the native window
against it. Hot reload works for the frontend; the Rust side rebuilds on
change.

## Test

```bash
pnpm test        # frontend (Vitest) — invoke() wrapper shapes, selectors,
                  # CSV export, permissions, the seed JSON's own validity
cd src-tauri && cargo test   # Rust — the actual SQL logic (see db.rs's
                              # #[cfg(test)] module), against a real
                              # in-memory SQLite connection with migrations
                              # applied. This is where persistence
                              # correctness is actually verified now.
```

The Rust and frontend test suites cover different things: `cargo test`
exercises the real SQL against real SQLite (insert/update/delete,
cascades, orphan cleanup, the money/rate unit conversions); `pnpm test`
covers everything that's still pure frontend logic (currency conversion,
CSV formatting, role permissions) plus a thin check that `queries.ts`
calls the right command names with the right argument shapes.

## Build a Linux binary

```bash
pnpm run tauri build
```

Output artifacts:

- `src-tauri/target/release/ledgerone` — the plain ELF binary
- `src-tauri/target/release/bundle/deb/*.deb` — Debian package
- `src-tauri/target/release/bundle/appimage/*.AppImage` — portable AppImage

## Data location

The ledger lives in a SQLite database (`ledger.db`) under the OS-standard
per-app data directory, resolved by Tauri itself from the `identifier` in
`tauri.conf.json` (`app.ledgerone.desktop`) — not something this codebase
computes manually. On Linux that's typically
`~/.local/share/app.ledgerone.desktop/ledger.db`; check your platform's
Tauri app-data-dir docs for macOS/Windows equivalents. Delete the file to
fully reset the app (the in-app "Reset workspace" in Settings does the same
thing without leaving the app).

## Schema changes

Add a new file to `packages/db/drizzle/` (e.g. `0002_whatever.sql`), then:

1. Register it in `packages/db/src/migrations.ts`'s `MIGRATION_FILES`
   (order matters, `triggers.sql` stays last) — this list isn't executed
   at runtime, it's what `packages/db`'s own tooling (drizzle-kit,
   `migrate:dev`) uses, and is worth keeping in sync for anyone using that.
2. Register it in `src-tauri/src/db.rs`'s `MIGRATIONS` array, in the same
   order.
3. Mirror the column(s) in `packages/db/src/schema.ts` (drizzle schema —
   used to author/document the shape, not executed at runtime), in the
   matching Rust struct(s) in `db.rs`, and in whichever `db.rs` functions
   read/write that table (row-mapping functions like `domain_from_row`,
   and the insert/update functions).
4. If the frontend needs the new field, mirror it in
   `src/lib/ledger/types.ts` too — `#[serde(rename_all = "camelCase")]` on
   every Rust struct keeps the wire format matching TS's camelCase
   automatically, so no manual translation needed there.

## Notes on other platforms

`tauri build` targets your current OS. To produce macOS `.app`/`.dmg` or
Windows `.exe`/MSI you need to run `tauri build` on those OSes (or via CI).
The frontend and Rust code are unchanged — only `bundle.targets` in
`tauri.conf.json` differs per host.

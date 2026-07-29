// LedgerOne — Tauri desktop shell.
//
// Design notes:
// The application is local-first. All financial reality lives in a SQLite
// database opened and queried directly in Rust (see `db.rs` — a plain
// `rusqlite::Connection` managed as Tauri state, not routed through a
// generic SQL plugin). The frontend calls typed commands
// (`db_insert_transaction`, `db_select_ledger_state`, etc.); Rust owns the
// actual SQL. `packages/db/drizzle/*.sql` remains the single source of
// truth for the schema — the same files are embedded here via
// `include_str!` and run as migrations on boot (see `db::MIGRATIONS`).
//
// Rust also owns: seeding/resetting the demo workspace from the
// compile-time-embedded seed ledger, reading/writing the actual bytes for
// Export/Import once the frontend has picked a path via a native dialog,
// and resolving the OS-standard app-data directory for "Show database
// file". It has no opinions about balances or reports — those are derived
// entirely on the frontend.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod db;

use std::sync::Mutex;

/// Called by the frontend once the ledger has hydrated and the lock-gate
/// has resolved (see @/components/lock-gate) — i.e. once there's something
/// real to show. Closes the splashscreen and reveals the main window,
/// rather than the reverse order, so there's never a frame with neither
/// window visible.
#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(main) = app.get_webview_window("main") {
        if let Err(e) = main.show() {
            eprintln!("[close_splashscreen] failed to show main window: {e}");
        }
        if let Err(e) = main.set_focus() {
            eprintln!("[close_splashscreen] failed to focus main window: {e}");
        }
    }
    if let Some(splash) = app.get_webview_window("splashscreen") {
        if let Err(e) = splash.close() {
            eprintln!("[close_splashscreen] failed to close splashscreen: {e}");
        }
    }
}

// Export/Import write straight to disk from Rust once the frontend has
// already picked a path via the native dialog (@tauri-apps/plugin-dialog's
// save()/open()). We don't route this through tauri-plugin-fs: its ACL
// scope has to be declared ahead of time and doesn't cleanly cover
// "wherever the user just navigated to in a save dialog". A dedicated
// command sidesteps that entirely — Tauri's own docs recommend exactly
// this when the path isn't known in advance.
#[tauri::command]
fn write_export_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_import_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// The frontend can't resolve the OS-standard app-data directory itself —
/// that's platform-specific logic Tauri already knows. Used by Settings'
/// "Show database file" to reveal it in the OS file manager.
#[tauri::command]
fn get_db_path(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("ledger.db").to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            close_splashscreen,
            write_export_file,
            read_import_file,
            get_db_path,
            db::db_ensure_seeded,
            db::db_select_ledger_state,
            db::db_insert_domain,
            db::db_update_domain,
            db::db_delete_domain,
            db::db_insert_object,
            db::db_update_object,
            db::db_delete_object,
            db::db_insert_allocation,
            db::db_insert_goal,
            db::db_insert_budget,
            db::db_insert_category,
            db::db_insert_transaction,
            db::db_update_transaction,
            db::db_delete_transaction,
            db::db_upsert_fx_rate,
            db::db_delete_fx_rate_for_base,
            db::db_set_currency_enabled,
            db::db_save_settings,
            db::db_get_setting,
            db::db_set_setting,
            db::db_replace_ledger,
            db::db_reset_workspace,
        ])
        .setup(|app| {
            use tauri::Manager;

            // Open + migrate the database once at startup and hand it to
            // every command as managed state, rather than each command
            // opening its own connection.
            let conn = db::open_and_migrate(app.handle())
                .expect("open and migrate the ledger database");
            app.manage(db::DbState(Mutex::new(conn)));

            #[cfg(debug_assertions)]
            {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }

            // Safety net: close_splashscreen is normally invoked by the
            // frontend once LockGate resolves its first render (see
            // src/components/lock-gate.tsx). If that never happens — a JS
            // error before mount, a stalled hydrate — don't leave the user
            // staring at the splash forever.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                if let Some(main) = handle.get_webview_window("main") {
                    if !main.is_visible().unwrap_or(false) {
                        if let Err(e) = main.show() {
                            eprintln!("[splash-safety-net] failed to show main window: {e}");
                        }
                        if let Err(e) = main.set_focus() {
                            eprintln!("[splash-safety-net] failed to focus main window: {e}");
                        }
                        if let Some(splash) = handle.get_webview_window("splashscreen") {
                            if let Err(e) = splash.close() {
                                eprintln!("[splash-safety-net] failed to close splashscreen: {e}");
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LedgerOne");
}

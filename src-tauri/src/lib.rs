mod commands;
mod state;
mod watch;

use std::sync::Mutex;

use cobble_watcher::PageWatcher;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // A dev/M1 default: the app data dir, not yet user-configurable.
      // Workspace-picker/multi-workspace support is future scope.
      let data_dir = app.path().app_data_dir()?;
      let workspace = cobble_storage::Workspace::open(data_dir.join("workspace"))?;

      // The index is a fully rebuildable cache over the page files (see
      // "Files are truth, SQLite is a cache" in CLAUDE.md) — `rebuild_all()`
      // on every startup means a missing/corrupt/stale `.cobble/index.sqlite3`
      // (or one written by an older schema) always self-heals rather than
      // needing a migration.
      let index_path = workspace.root().join(".cobble").join("index.sqlite3");
      let mut index = cobble_index::Index::open(&index_path)?;
      index.rebuild_all(workspace.pages_dir())?;

      // Start watching before handing the workspace off to commands, so no
      // write that happens after `setup()` can land between "index built"
      // and "watcher live".
      let (watcher, watch_rx) = PageWatcher::spawn(workspace.pages_dir())?;

      app.manage(state::AppState {
        workspace,
        index: Mutex::new(index),
      });

      // Drains `cobble-watcher`'s events for the app's lifetime, applying
      // each one to the index. This is what makes the write path uniform
      // for internal and external edits alike: write commands (see
      // `commands::pages`) already reindex synchronously right after their
      // own atomic file write so their *own* following reads never see a
      // stale index, but every change to a page file — including the app's
      // own writes — also flows through here. That's deliberately
      // redundant-but-idempotent for internal writes (the file's already
      // current, so this is a no-op re-read) and it's the *only* path for
      // genuinely external edits (another process touching a page file
      // directly), so one reindex mechanism covers both instead of two
      // divergent ones.
      let app_handle = app.handle().clone();
      std::thread::spawn(move || {
        // Owning `watcher` here (rather than in `AppState`) keeps its
        // background thread — and therefore `watch_rx` — alive for exactly
        // as long as this drain loop runs, with no extra locking: nothing
        // else ever needs to reach the watcher itself after startup.
        let _watcher = watcher;
        while let Ok(event) = watch_rx.recv() {
          let state = app_handle.state::<state::AppState>();
          let mut index = match state.index.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
          };
          let result = watch::apply_watch_event(&mut index, &event);
          drop(index);
          if let Err(err) = result {
            log::warn!(
              "cobble-index: failed to apply watch event for {:?}: {err}",
              event.path()
            );
          }
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::pages::create_page,
      commands::pages::get_page,
      commands::pages::update_page_blocks,
      commands::pages::list_children,
      commands::pages::move_page,
      commands::pages::delete_page,
      commands::search::search_pages,
      commands::search::get_backlinks,
      commands::trash::list_trash,
      commands::trash::restore_page,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

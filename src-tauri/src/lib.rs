mod commands;
mod state;

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
      app.manage(state::AppState { workspace });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::pages::create_page,
      commands::pages::get_page,
      commands::pages::update_page_blocks,
      commands::pages::list_children,
      commands::pages::move_page,
      commands::pages::delete_page,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

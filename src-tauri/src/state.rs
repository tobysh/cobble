use std::sync::Mutex;

use cobble_index::Index;
use cobble_storage::Workspace;

/// Managed Tauri state. `Workspace` holds only a root path (no interior
/// mutability), so it's `Send + Sync` for free and needs no locking —
/// concurrency safety comes from the filesystem itself (atomic writes).
/// `Index` wraps a `rusqlite::Connection`, which is `Send` but not `Sync`,
/// so it's behind a `Mutex`: every command and the watcher-drain thread
/// (see `lib.rs`) take a short lock, do one query/write, and release it.
pub struct AppState {
    pub workspace: Workspace,
    pub index: Mutex<Index>,
}

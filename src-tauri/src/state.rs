use cobble_storage::Workspace;

/// Managed Tauri state. `Workspace` holds only a root path (no interior
/// mutability), so it's `Send + Sync` for free and needs no locking —
/// concurrency safety comes from the filesystem itself (atomic writes).
pub struct AppState {
    pub workspace: Workspace,
}

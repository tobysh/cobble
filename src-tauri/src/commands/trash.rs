use cobble_core::{Page, PageId};
use cobble_index::Index;
use cobble_storage::Workspace;
use tauri::State;

use crate::state::AppState;

/// Pages currently sitting in `.cobble/trash/` — see `Workspace::list_trash`.
/// Read straight from the trashed files themselves, same as `list_pages`
/// reads from `pages/`; trashed pages aren't tracked in `cobble-index` (they
/// were removed from it by `delete_page`), so there's no faster query to go
/// through here.
#[tauri::command]
pub fn list_trash(state: State<AppState>) -> Result<Vec<Page>, String> {
    state.workspace.list_trash().map_err(|err| err.to_string())
}

/// Inverse of `delete_page` (see `commands::pages::delete_page`): moves a
/// trashed page's file back into `pages/` via `Workspace::restore_page`, then
/// reindexes it so it's immediately visible again — the same
/// write-then-reindex shape every other write command in `commands::pages`
/// follows.
#[tauri::command]
pub fn restore_page(state: State<AppState>, id: PageId) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    restore_page_impl(&state.workspace, &mut index, id)
}

fn restore_page_impl(workspace: &Workspace, index: &mut Index, id: PageId) -> Result<Page, String> {
    let path = workspace.restore_page(id).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    workspace
        .read_page_by_id(id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("page {id} not found immediately after restore"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_temp_workspace() -> (tempfile::TempDir, Workspace, Index) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let index = Index::open_in_memory().unwrap();
        (dir, workspace, index)
    }

    // `list_trash`'s `#[tauri::command]` wrapper is a one-line passthrough to
    // `Workspace::list_trash` (no `_impl` split needed — there's no `Index`
    // involved), which already has its own coverage in
    // `cobble-storage::workspace::tests`. `restore_page_impl` below is what
    // actually needs command-layer tests, since it's the one that wires
    // `Workspace::restore_page` together with reindexing.

    #[test]
    fn restore_page_moves_it_back_and_reindexes_it() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let page = Page::new("Reprieved");
        let path = workspace.write_page(&page).unwrap();
        index.reindex_file(&path).unwrap();

        workspace.trash_page(page.id).unwrap();
        index.remove_file(&path).unwrap();
        assert!(index.list_children(None).unwrap().is_empty());

        let restored = restore_page_impl(&workspace, &mut index, page.id).unwrap();

        assert_eq!(restored.id, page.id);
        assert!(workspace.list_trash().unwrap().is_empty());
        assert_eq!(index.list_children(None).unwrap(), vec![page.id]);
    }

    #[test]
    fn restore_page_errors_for_an_unknown_id() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let err = restore_page_impl(&workspace, &mut index, PageId::new()).unwrap_err();
        assert!(err.contains("not found"));
    }
}

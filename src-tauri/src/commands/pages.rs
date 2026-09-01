use cobble_core::{Block, Page, PageId, PageKind};
use cobble_index::Index;
use cobble_storage::Workspace;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// Lighter-weight than `Page` for listing — sourced from `cobble-index`
/// (`Index::list_children_summaries`) instead of a full file read per page,
/// see `list_children` below.
#[derive(Debug, Clone, Serialize)]
pub struct PageSummary {
    pub id: PageId,
    pub parent_id: Option<PageId>,
    pub kind: PageKind,
    pub title: String,
    pub icon: Option<String>,
}

impl From<cobble_index::PageSummary> for PageSummary {
    fn from(summary: cobble_index::PageSummary) -> Self {
        Self {
            id: summary.id,
            parent_id: summary.parent_id,
            kind: summary.kind,
            title: summary.title,
            icon: summary.icon,
        }
    }
}

// Each `#[tauri::command]` below is a thin wrapper around a plain function
// over `&Workspace`/`&mut Index` — keeps the actual logic unit-testable
// without spinning up a Tauri `App` just to get a `State`.
//
// Write commands follow the write path in
// `docs/ARCHITECTURE.md#file-format--storage`: mutate in-memory, atomic file
// write via `cobble-storage`, then reindex just that file synchronously
// before returning. That reindex is intentionally redundant with what
// `cobble-watcher` will *also* do moments later when it notices the same
// file change (see the drain loop in `lib.rs`) — the synchronous call is
// what guarantees a command's own following reads (and any other command
// racing right behind it) never see a stale index, while the watcher is
// what makes genuinely external edits (a file touched by another process)
// converge without needing a second, divergent reindex mechanism.

#[tauri::command]
pub fn create_page(
    state: State<AppState>,
    title: String,
    parent_id: Option<PageId>,
) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    create_page_impl(&state.workspace, &mut index, title, parent_id)
}

fn create_page_impl(
    workspace: &Workspace,
    index: &mut Index,
    title: String,
    parent_id: Option<PageId>,
) -> Result<Page, String> {
    let mut page = Page::new(title);
    page.parent_id = parent_id;
    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}

#[tauri::command]
pub fn get_page(state: State<AppState>, id: PageId) -> Result<Option<Page>, String> {
    get_page_impl(&state.workspace, id)
}

fn get_page_impl(workspace: &Workspace, id: PageId) -> Result<Option<Page>, String> {
    workspace.read_page_by_id(id).map_err(|err| err.to_string())
}

/// Replaces a page's block content wholesale — the editor always holds the
/// full block tree client-side, so a partial/diffed update isn't needed yet.
#[tauri::command]
pub fn update_page_blocks(
    state: State<AppState>,
    id: PageId,
    blocks: Vec<Block>,
) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    update_page_blocks_impl(&state.workspace, &mut index, id, blocks)
}

fn update_page_blocks_impl(
    workspace: &Workspace,
    index: &mut Index,
    id: PageId,
    blocks: Vec<Block>,
) -> Result<Page, String> {
    let mut page = load_page(workspace, id)?;
    page.blocks = blocks;
    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}

/// Renames a page in place (title only — `parent_id`/`blocks`/`properties`
/// untouched). This is the gap the frontend's `updatePageTitle` used to work
/// around with a local-only edit that didn't survive a restart (see
/// `frontend/src/state/store.ts`); it now persists through here.
#[tauri::command]
pub fn rename_page(state: State<AppState>, id: PageId, title: String) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    rename_page_impl(&state.workspace, &mut index, id, title)
}

fn rename_page_impl(
    workspace: &Workspace,
    index: &mut Index,
    id: PageId,
    title: String,
) -> Result<Page, String> {
    let mut page = load_page(workspace, id)?;
    page.title = title;
    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}

/// Sourced from `cobble-index` (a SQLite query) rather than reading every
/// page file in the workspace directly.
#[tauri::command]
pub fn list_children(
    state: State<AppState>,
    parent_id: Option<PageId>,
) -> Result<Vec<PageSummary>, String> {
    let index = state.index.lock().map_err(|_| "index lock poisoned")?;
    list_children_impl(&index, parent_id)
}

fn list_children_impl(index: &Index, parent_id: Option<PageId>) -> Result<Vec<PageSummary>, String> {
    let summaries = index
        .list_children_summaries(parent_id)
        .map_err(|err| err.to_string())?;
    Ok(summaries.into_iter().map(PageSummary::from).collect())
}

#[tauri::command]
pub fn move_page(
    state: State<AppState>,
    id: PageId,
    new_parent_id: Option<PageId>,
) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    move_page_impl(&state.workspace, &mut index, id, new_parent_id)
}

fn move_page_impl(
    workspace: &Workspace,
    index: &mut Index,
    id: PageId,
    new_parent_id: Option<PageId>,
) -> Result<Page, String> {
    let mut page = load_page(workspace, id)?;
    page.parent_id = new_parent_id;
    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}

/// Soft delete — moves the page's file into `.cobble/trash/` (see
/// `Workspace::trash_page`), never a hard delete.
#[tauri::command]
pub fn delete_page(state: State<AppState>, id: PageId) -> Result<(), String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    delete_page_impl(&state.workspace, &mut index, id)
}

fn delete_page_impl(workspace: &Workspace, index: &mut Index, id: PageId) -> Result<(), String> {
    // Resolve the path before trashing it — once the file is moved into
    // `.cobble/trash/`, `find_page_path` (which only looks in `pages/`)
    // can no longer find it, and `Index::remove_file` needs the *original*
    // path to recover the page ID from its filename.
    let path = workspace.find_page_path(id).map_err(|err| err.to_string())?;
    workspace.trash_page(id).map_err(|err| err.to_string())?;
    if let Some(path) = path {
        index.remove_file(&path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn load_page(workspace: &Workspace, id: PageId) -> Result<Page, String> {
    workspace
        .read_page_by_id(id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("page {id} not found"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A workspace plus an index over it, exactly as `AppState` pairs them —
    /// write commands reindex synchronously after each write (see the
    /// comment above `create_page`), so tests exercise that same path
    /// rather than calling `cobble-index` separately.
    fn open_temp_workspace() -> (tempfile::TempDir, Workspace, Index) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let index = Index::open_in_memory().unwrap();
        (dir, workspace, index)
    }

    #[test]
    fn create_then_get_round_trips() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let page = create_page_impl(&workspace, &mut index, "Q3 Planning".into(), None).unwrap();

        let fetched = get_page_impl(&workspace, page.id).unwrap().unwrap();
        assert_eq!(fetched, page);
    }

    #[test]
    fn get_missing_page_returns_none_not_an_error() {
        let (_dir, workspace, _index) = open_temp_workspace();
        assert_eq!(get_page_impl(&workspace, PageId::new()).unwrap(), None);
    }

    #[test]
    fn update_page_blocks_replaces_content_and_persists() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let page = create_page_impl(&workspace, &mut index, "Notes".into(), None).unwrap();

        let block = Block::new(cobble_core::BlockType::Paragraph).with_text("hello");
        let updated =
            update_page_blocks_impl(&workspace, &mut index, page.id, vec![block.clone()])
                .unwrap();
        assert_eq!(updated.blocks, vec![block]);

        let reloaded = get_page_impl(&workspace, page.id).unwrap().unwrap();
        assert_eq!(reloaded.blocks.len(), 1);
    }

    #[test]
    fn update_page_blocks_errors_for_an_unknown_id() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let err =
            update_page_blocks_impl(&workspace, &mut index, PageId::new(), vec![]).unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn rename_page_updates_title_and_persists() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let page = create_page_impl(&workspace, &mut index, "Old Title".into(), None).unwrap();

        let renamed =
            rename_page_impl(&workspace, &mut index, page.id, "New Title".into()).unwrap();
        assert_eq!(renamed.title, "New Title");

        let reloaded = get_page_impl(&workspace, page.id).unwrap().unwrap();
        assert_eq!(reloaded.title, "New Title");
    }

    #[test]
    fn rename_page_errors_for_an_unknown_id() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let err = rename_page_impl(&workspace, &mut index, PageId::new(), "X".into()).unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn list_children_filters_by_parent_including_root() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let root_a = create_page_impl(&workspace, &mut index, "Root A".into(), None).unwrap();
        let _root_b = create_page_impl(&workspace, &mut index, "Root B".into(), None).unwrap();
        let child =
            create_page_impl(&workspace, &mut index, "Child".into(), Some(root_a.id)).unwrap();

        let roots = list_children_impl(&index, None).unwrap();
        assert_eq!(roots.len(), 2);

        let children_of_a = list_children_impl(&index, Some(root_a.id)).unwrap();
        assert_eq!(children_of_a.len(), 1);
        assert_eq!(children_of_a[0].id, child.id);
    }

    /// Verifies the index-backed `list_children` reflects a `rebuild_all()`
    /// from scratch (not just incremental writes made through these
    /// commands) — the scenario when the app starts up against a workspace
    /// that already has pages on disk.
    #[test]
    fn list_children_reflects_a_full_rebuild_from_files_on_disk() {
        let (dir, workspace, mut index) = open_temp_workspace();
        let root = Page::new("Existing Root");
        workspace.write_page(&root).unwrap();
        let mut child = Page::new("Existing Child");
        child.parent_id = Some(root.id);
        workspace.write_page(&child).unwrap();

        index.rebuild_all(dir.path().join("pages")).unwrap();

        let roots = list_children_impl(&index, None).unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].id, root.id);
        assert_eq!(roots[0].title, "Existing Root");

        let children = list_children_impl(&index, Some(root.id)).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, child.id);
    }

    #[test]
    fn move_page_updates_parent_and_is_reflected_in_listings() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let old_parent =
            create_page_impl(&workspace, &mut index, "Old Parent".into(), None).unwrap();
        let new_parent =
            create_page_impl(&workspace, &mut index, "New Parent".into(), None).unwrap();
        let child = create_page_impl(
            &workspace,
            &mut index,
            "Movable".into(),
            Some(old_parent.id),
        )
        .unwrap();

        move_page_impl(&workspace, &mut index, child.id, Some(new_parent.id)).unwrap();

        assert_eq!(
            list_children_impl(&index, Some(old_parent.id)).unwrap().len(),
            0
        );
        assert_eq!(
            list_children_impl(&index, Some(new_parent.id)).unwrap().len(),
            1
        );
    }

    #[test]
    fn delete_page_moves_it_to_trash_and_it_disappears_from_listings() {
        let (dir, workspace, mut index) = open_temp_workspace();
        let page = create_page_impl(&workspace, &mut index, "Doomed".into(), None).unwrap();

        delete_page_impl(&workspace, &mut index, page.id).unwrap();

        assert_eq!(get_page_impl(&workspace, page.id).unwrap(), None);
        assert!(list_children_impl(&index, None).unwrap().is_empty());
        let trashed: Vec<_> = std::fs::read_dir(dir.path().join(".cobble").join("trash"))
            .unwrap()
            .collect();
        assert_eq!(trashed.len(), 1);
    }
}

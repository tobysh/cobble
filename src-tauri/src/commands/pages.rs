use cobble_core::{Block, Page, PageId, PageKind};
use cobble_storage::Workspace;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// Lighter-weight than `Page` for listing — still requires a full file read
/// per page (the on-disk format keeps blocks and metadata together), but
/// keeps the IPC payload small. `cobble-index` will replace this scan-based
/// approach with a real query once it exists.
#[derive(Debug, Clone, Serialize)]
pub struct PageSummary {
    pub id: PageId,
    pub parent_id: Option<PageId>,
    pub kind: PageKind,
    pub title: String,
    pub icon: Option<String>,
}

impl From<&Page> for PageSummary {
    fn from(page: &Page) -> Self {
        Self {
            id: page.id,
            parent_id: page.parent_id,
            kind: page.kind,
            title: page.title.clone(),
            icon: page.icon.clone(),
        }
    }
}

// Each `#[tauri::command]` below is a thin wrapper around a plain function
// over `&Workspace` — keeps the actual logic unit-testable without spinning
// up a Tauri `App` just to get a `State`.

#[tauri::command]
pub fn create_page(
    state: State<AppState>,
    title: String,
    parent_id: Option<PageId>,
) -> Result<Page, String> {
    create_page_impl(&state.workspace, title, parent_id)
}

fn create_page_impl(
    workspace: &Workspace,
    title: String,
    parent_id: Option<PageId>,
) -> Result<Page, String> {
    let mut page = Page::new(title);
    page.parent_id = parent_id;
    workspace.write_page(&page).map_err(|err| err.to_string())?;
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
    update_page_blocks_impl(&state.workspace, id, blocks)
}

fn update_page_blocks_impl(
    workspace: &Workspace,
    id: PageId,
    blocks: Vec<Block>,
) -> Result<Page, String> {
    let mut page = load_page(workspace, id)?;
    page.blocks = blocks;
    workspace.write_page(&page).map_err(|err| err.to_string())?;
    Ok(page)
}

#[tauri::command]
pub fn list_children(
    state: State<AppState>,
    parent_id: Option<PageId>,
) -> Result<Vec<PageSummary>, String> {
    list_children_impl(&state.workspace, parent_id)
}

fn list_children_impl(
    workspace: &Workspace,
    parent_id: Option<PageId>,
) -> Result<Vec<PageSummary>, String> {
    let pages = workspace.list_pages().map_err(|err| err.to_string())?;
    Ok(pages
        .iter()
        .filter(|page| page.parent_id == parent_id)
        .map(PageSummary::from)
        .collect())
}

#[tauri::command]
pub fn move_page(
    state: State<AppState>,
    id: PageId,
    new_parent_id: Option<PageId>,
) -> Result<Page, String> {
    move_page_impl(&state.workspace, id, new_parent_id)
}

fn move_page_impl(
    workspace: &Workspace,
    id: PageId,
    new_parent_id: Option<PageId>,
) -> Result<Page, String> {
    let mut page = load_page(workspace, id)?;
    page.parent_id = new_parent_id;
    workspace.write_page(&page).map_err(|err| err.to_string())?;
    Ok(page)
}

/// Soft delete — moves the page's file into `.cobble/trash/` (see
/// `Workspace::trash_page`), never a hard delete.
#[tauri::command]
pub fn delete_page(state: State<AppState>, id: PageId) -> Result<(), String> {
    delete_page_impl(&state.workspace, id)
}

fn delete_page_impl(workspace: &Workspace, id: PageId) -> Result<(), String> {
    workspace.trash_page(id).map_err(|err| err.to_string())
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

    fn open_temp_workspace() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        (dir, workspace)
    }

    #[test]
    fn create_then_get_round_trips() {
        let (_dir, workspace) = open_temp_workspace();
        let page = create_page_impl(&workspace, "Q3 Planning".into(), None).unwrap();

        let fetched = get_page_impl(&workspace, page.id).unwrap().unwrap();
        assert_eq!(fetched, page);
    }

    #[test]
    fn get_missing_page_returns_none_not_an_error() {
        let (_dir, workspace) = open_temp_workspace();
        assert_eq!(get_page_impl(&workspace, PageId::new()).unwrap(), None);
    }

    #[test]
    fn update_page_blocks_replaces_content_and_persists() {
        let (_dir, workspace) = open_temp_workspace();
        let page = create_page_impl(&workspace, "Notes".into(), None).unwrap();

        let block = Block::new(cobble_core::BlockType::Paragraph).with_text("hello");
        let updated =
            update_page_blocks_impl(&workspace, page.id, vec![block.clone()]).unwrap();
        assert_eq!(updated.blocks, vec![block]);

        let reloaded = get_page_impl(&workspace, page.id).unwrap().unwrap();
        assert_eq!(reloaded.blocks.len(), 1);
    }

    #[test]
    fn update_page_blocks_errors_for_an_unknown_id() {
        let (_dir, workspace) = open_temp_workspace();
        let err = update_page_blocks_impl(&workspace, PageId::new(), vec![]).unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn list_children_filters_by_parent_including_root() {
        let (_dir, workspace) = open_temp_workspace();
        let root_a = create_page_impl(&workspace, "Root A".into(), None).unwrap();
        let _root_b = create_page_impl(&workspace, "Root B".into(), None).unwrap();
        let child = create_page_impl(&workspace, "Child".into(), Some(root_a.id)).unwrap();

        let roots = list_children_impl(&workspace, None).unwrap();
        assert_eq!(roots.len(), 2);

        let children_of_a = list_children_impl(&workspace, Some(root_a.id)).unwrap();
        assert_eq!(children_of_a.len(), 1);
        assert_eq!(children_of_a[0].id, child.id);
    }

    #[test]
    fn move_page_updates_parent_and_is_reflected_in_listings() {
        let (_dir, workspace) = open_temp_workspace();
        let old_parent = create_page_impl(&workspace, "Old Parent".into(), None).unwrap();
        let new_parent = create_page_impl(&workspace, "New Parent".into(), None).unwrap();
        let child =
            create_page_impl(&workspace, "Movable".into(), Some(old_parent.id)).unwrap();

        move_page_impl(&workspace, child.id, Some(new_parent.id)).unwrap();

        assert_eq!(list_children_impl(&workspace, Some(old_parent.id)).unwrap().len(), 0);
        assert_eq!(list_children_impl(&workspace, Some(new_parent.id)).unwrap().len(), 1);
    }

    #[test]
    fn delete_page_moves_it_to_trash_and_it_disappears_from_listings() {
        let (dir, workspace) = open_temp_workspace();
        let page = create_page_impl(&workspace, "Doomed".into(), None).unwrap();

        delete_page_impl(&workspace, page.id).unwrap();

        assert_eq!(get_page_impl(&workspace, page.id).unwrap(), None);
        let trashed: Vec<_> = std::fs::read_dir(dir.path().join(".cobble").join("trash"))
            .unwrap()
            .collect();
        assert_eq!(trashed.len(), 1);
    }
}

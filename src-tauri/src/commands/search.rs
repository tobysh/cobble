use cobble_core::{BlockId, PageId};
use cobble_index::Index;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// A single FTS5 hit against a page's flattened block text, sent to the
/// frontend as a plain DTO (`cobble_index::SearchHit` doesn't derive
/// `Serialize` itself — same thin-wrapper pattern as `PageSummary` in
/// `commands::pages`). The frontend already holds every page's title/icon in
/// its own state (see `state/store.ts`'s `loadWorkspace`), so this only
/// carries what the index alone knows: which block matched, and its text.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub block_id: BlockId,
    pub page_id: PageId,
    pub text: String,
}

impl From<cobble_index::SearchHit> for SearchHit {
    fn from(hit: cobble_index::SearchHit) -> Self {
        Self {
            block_id: hit.block_id,
            page_id: hit.page_id,
            text: hit.text,
        }
    }
}

/// Full-text search over every page's block content, backed by
/// `cobble_index::Index::search_blocks` (SQLite FTS5). `query` is always
/// treated as plain user text, never FTS5 match syntax — see
/// `cobble_index::query::sanitize_fts5_query`'s docs for why that's safe.
#[tauri::command]
pub fn search_pages(state: State<AppState>, query: String) -> Result<Vec<SearchHit>, String> {
    let index = state.index.lock().map_err(|_| "index lock poisoned")?;
    search_pages_impl(&index, &query)
}

fn search_pages_impl(index: &Index, query: &str) -> Result<Vec<SearchHit>, String> {
    index
        .search_blocks(query)
        .map(|hits| hits.into_iter().map(SearchHit::from).collect())
        .map_err(|err| err.to_string())
}

/// Pages that link to `id` via a relation property or a sub-page block —
/// backed by `cobble_index::Index::backlinks`. Returns bare `PageId`s; the
/// frontend resolves title/icon from its own already-loaded page state, same
/// as `search_pages` above.
#[tauri::command]
pub fn get_backlinks(state: State<AppState>, id: PageId) -> Result<Vec<PageId>, String> {
    let index = state.index.lock().map_err(|_| "index lock poisoned")?;
    get_backlinks_impl(&index, id)
}

fn get_backlinks_impl(index: &Index, id: PageId) -> Result<Vec<PageId>, String> {
    index.backlinks(id).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use cobble_core::{Page, PropertyValue};
    use cobble_storage::Workspace;

    fn open_temp_workspace() -> (tempfile::TempDir, Workspace, Index) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let index = Index::open_in_memory().unwrap();
        (dir, workspace, index)
    }

    #[test]
    fn search_pages_finds_a_written_page_after_reindexing() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let mut page = Page::new("Notes");
        page.blocks.push(
            cobble_core::Block::new(cobble_core::BlockType::Paragraph)
                .with_text("the quick brown fox"),
        );
        let path = workspace.write_page(&page).unwrap();
        index.reindex_file(&path).unwrap();

        let hits = search_pages_impl(&index, "brown").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_id, page.id);
        assert!(hits[0].text.contains("brown"));

        assert!(search_pages_impl(&index, "nonexistent").unwrap().is_empty());
    }

    #[test]
    fn get_backlinks_finds_pages_linking_via_a_relation_property() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let target = Page::new("Target");
        let target_path = workspace.write_page(&target).unwrap();
        index.reindex_file(&target_path).unwrap();

        let mut source = Page::new("Source");
        source
            .properties
            .insert("related".into(), PropertyValue::Relation(vec![target.id]));
        let source_path = workspace.write_page(&source).unwrap();
        index.reindex_file(&source_path).unwrap();

        let backlinks = get_backlinks_impl(&index, target.id).unwrap();
        assert_eq!(backlinks, vec![source.id]);
    }
}

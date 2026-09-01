//! Cobble's derived SQLite index: fast queries, FTS5 search, and the
//! calendar's date lookup. Rebuildable from the page files at any time — see
//! "Files are truth, SQLite is a cache" in `CLAUDE.md`. This crate never
//! writes to page files; that's `cobble-storage`'s job.

mod error;
mod query;
mod rebuild;
mod schema;

use std::path::Path;

use cobble_core::PageId;
use rusqlite::Connection;

pub use error::{IndexError, Result};
pub use query::{PageSummary, SearchHit};
pub use rebuild::{RebuildStats, ReindexOutcome};

/// A handle to the derived index database.
pub struct Index {
    conn: Connection,
}

impl Index {
    /// Opens (creating if absent) the index database at `path` and ensures
    /// its schema exists. Does not populate it — call `rebuild_all()` after
    /// opening a fresh or possibly-stale database.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        schema::apply(&conn)?;
        Ok(Self { conn })
    }

    /// An in-memory index, mainly for tests and for the "index missing/corrupt,
    /// rebuild before use" recovery path.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        schema::apply(&conn)?;
        Ok(Self { conn })
    }

    /// Wipes and repopulates the entire index by rescanning every
    /// `*.cobble.json` file directly under `pages_dir`. This is the recovery
    /// path when the index is missing, corrupt, or schema-version-mismatched
    /// — see `docs/ARCHITECTURE.md#file-format--storage`.
    pub fn rebuild_all(&mut self, pages_dir: impl AsRef<Path>) -> Result<RebuildStats> {
        rebuild::rebuild_all(&mut self.conn, pages_dir.as_ref())
    }

    /// Direct children of `parent_id` (`None` = top-level pages), ordered by
    /// title.
    pub fn list_children(&self, parent_id: Option<PageId>) -> Result<Vec<PageId>> {
        query::list_children(&self.conn, parent_id)
    }

    /// Same as `list_children`, but returns the full listing shape (title,
    /// icon, kind) the page tree/sidebar needs in one query, instead of just
    /// IDs.
    pub fn list_children_summaries(&self, parent_id: Option<PageId>) -> Result<Vec<PageSummary>> {
        query::list_children_summaries(&self.conn, parent_id)
    }

    /// Re-reads a single page file and updates just its rows in the index —
    /// the incremental counterpart to `rebuild_all()`. Driven by
    /// `cobble-watcher`'s `Created`/`Modified` events, and called
    /// synchronously by write commands right after their own atomic file
    /// write (see `docs/ARCHITECTURE.md#file-format--storage`'s write path).
    pub fn reindex_file(&mut self, path: impl AsRef<Path>) -> Result<ReindexOutcome> {
        rebuild::reindex_file(&mut self.conn, path.as_ref())
    }

    /// Removes a page file's rows from the index without reading it — for
    /// `cobble-watcher`'s `Removed` events and write commands that trash a
    /// page, where the file is already gone by the time this is called.
    pub fn remove_file(&mut self, path: impl AsRef<Path>) -> Result<()> {
        rebuild::remove_file(&mut self.conn, path.as_ref())
    }

    /// Pages whose reserved `date` property falls within `[start, end]`
    /// (ISO 8601, inclusive) — powers the global calendar.
    pub fn pages_with_date_between(&self, start: &str, end: &str) -> Result<Vec<PageId>> {
        query::pages_with_date_between(&self.conn, start, end)
    }

    /// Full-text search over block content. `query` is plain user text —
    /// never interpreted as FTS5 match syntax, see `query::sanitize_fts5_query`.
    pub fn search_blocks(&self, query: &str) -> Result<Vec<SearchHit>> {
        query::search_blocks(&self.conn, query)
    }

    /// Pages that link to `target` via a relation property or a sub-page
    /// block.
    pub fn backlinks(&self, target: PageId) -> Result<Vec<PageId>> {
        query::backlinks(&self.conn, target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cobble_core::{Block, BlockType, Page, PageKind, PropertyValue};
    use std::fs;

    fn write_page(dir: &Path, page: &Page) {
        let file_name = format!(
            "{}-{}.cobble.json",
            page.title.to_lowercase().replace(' ', "-"),
            page.id
        );
        fs::write(dir.join(file_name), serde_json::to_vec(page).unwrap()).unwrap();
    }

    #[test]
    fn rebuild_all_indexes_pages_blocks_and_properties() {
        let dir = tempfile::tempdir().unwrap();

        let mut parent = Page::new("Journal");
        parent
            .blocks
            .push(Block::new(BlockType::Heading).with_text("Welcome"));
        let mut todo = Block::new(BlockType::Todo).with_text("write tests");
        todo.attrs
            .insert("checked".into(), serde_json::json!(false));
        parent.blocks.push(todo);
        write_page(dir.path(), &parent);

        let mut daily = Page::new("2026-09-01");
        daily.parent_id = Some(parent.id);
        daily
            .properties
            .insert("date".into(), PropertyValue::Date("2026-09-01".into()));
        daily
            .properties
            .insert("_is_daily_note".into(), PropertyValue::Checkbox(true));
        write_page(dir.path(), &daily);

        let mut index = Index::open_in_memory().unwrap();
        let stats = index.rebuild_all(dir.path()).unwrap();

        assert_eq!(stats.pages_indexed, 2);
        assert_eq!(stats.blocks_indexed, 2);
        assert!(stats.skipped.is_empty());

        let children = index.list_children(Some(parent.id)).unwrap();
        assert_eq!(children, vec![daily.id]);

        let top_level = index.list_children(None).unwrap();
        assert_eq!(top_level, vec![parent.id]);

        let in_range = index
            .pages_with_date_between("2026-08-01", "2026-09-30")
            .unwrap();
        assert_eq!(in_range, vec![daily.id]);

        let out_of_range = index
            .pages_with_date_between("2020-01-01", "2020-12-31")
            .unwrap();
        assert!(out_of_range.is_empty());
    }

    #[test]
    fn rebuild_all_is_idempotent_and_clears_stale_rows() {
        let dir = tempfile::tempdir().unwrap();
        let page = Page::new("Solo");
        write_page(dir.path(), &page);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();
        let first = index.list_children(None).unwrap();

        // Remove the file and rebuild again — the stale row must not survive.
        fs::remove_dir_all(dir.path()).unwrap();
        fs::create_dir(dir.path()).unwrap();
        let stats = index.rebuild_all(dir.path()).unwrap();

        assert_eq!(first, vec![page.id]);
        assert_eq!(stats.pages_indexed, 0);
        assert!(index.list_children(None).unwrap().is_empty());
    }

    #[test]
    fn rebuild_all_skips_corrupt_files_without_failing_the_whole_pass() {
        let dir = tempfile::tempdir().unwrap();
        let good = Page::new("Good Page");
        write_page(dir.path(), &good);
        fs::write(
            dir.path()
                .join("broken-01ARZ3NDEKTSV4RRFFQ69G5FAV.cobble.json"),
            b"{not json",
        )
        .unwrap();

        let mut index = Index::open_in_memory().unwrap();
        let stats = index.rebuild_all(dir.path()).unwrap();

        assert_eq!(stats.pages_indexed, 1);
        assert_eq!(stats.skipped.len(), 1);
        assert_eq!(index.list_children(None).unwrap(), vec![good.id]);
    }

    #[test]
    fn search_blocks_finds_text_via_fts5() {
        let dir = tempfile::tempdir().unwrap();
        let mut page = Page::new("Notes");
        page.blocks
            .push(Block::new(BlockType::Paragraph).with_text("the quick brown fox"));
        write_page(dir.path(), &page);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();

        let hits = index.search_blocks("brown").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_id, page.id);
        assert!(hits[0].text.contains("brown"));

        let no_hits = index.search_blocks("nonexistent").unwrap();
        assert!(no_hits.is_empty());
    }

    #[test]
    fn search_blocks_treats_fts5_syntax_as_literal_search_text() {
        let dir = tempfile::tempdir().unwrap();
        let mut page = Page::new("Notes");
        page.blocks
            .push(Block::new(BlockType::Paragraph).with_text("the quick brown fox"));
        write_page(dir.path(), &page);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();

        // None of these contain the word "brown", so a query that actually
        // parsed them as FTS5 syntax could error out or match everything;
        // treated as literal words they should just find nothing.
        for malicious in [
            "brown\" OR \"1\"=\"1",
            "AND OR NOT",
            "NEAR(brown fox)",
            "br*",
            "\"",
            "\"\"\"",
        ] {
            let hits = index.search_blocks(malicious).unwrap();
            assert!(
                hits.is_empty(),
                "query {malicious:?} unexpectedly matched: {hits:?}"
            );
        }

        // A quote embedded in an otherwise-matching token still finds the
        // block by its literal words either side of the quote.
        let hits = index.search_blocks("brown\" fox").unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn relation_properties_produce_backlinks() {
        let dir = tempfile::tempdir().unwrap();
        let target = Page::new("Target");
        write_page(dir.path(), &target);

        let mut source = Page::new("Source");
        source
            .properties
            .insert("related".into(), PropertyValue::Relation(vec![target.id]));
        write_page(dir.path(), &source);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();

        let backlinks = index.backlinks(target.id).unwrap();
        assert_eq!(backlinks, vec![source.id]);
    }

    #[test]
    fn sub_page_blocks_produce_backlinks_via_linked_page_id_attr() {
        let dir = tempfile::tempdir().unwrap();
        let target = Page::new("Child");
        write_page(dir.path(), &target);

        let mut source = Page::new("Parent");
        let mut sub_page_block = Block::new(BlockType::SubPage);
        sub_page_block.attrs.insert(
            "linked_page_id".into(),
            serde_json::json!(target.id.to_string()),
        );
        source.blocks.push(sub_page_block);
        write_page(dir.path(), &source);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();

        let backlinks = index.backlinks(target.id).unwrap();
        assert_eq!(backlinks, vec![source.id]);
    }

    #[test]
    fn database_page_preserves_schema_json() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Page::new("Tasks");
        db.kind = PageKind::Database;
        db.database_schema = Some(serde_json::json!({ "properties": {}, "views": [] }));
        write_page(dir.path(), &db);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();

        let schema_json: String = index
            .conn
            .query_row(
                "SELECT schema_json FROM database_schemas WHERE page_id = ?1",
                [db.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&schema_json).unwrap(),
            db.database_schema.unwrap()
        );
    }

    #[test]
    fn reindex_file_picks_up_a_newly_created_page_without_a_full_rebuild() {
        let dir = tempfile::tempdir().unwrap();
        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();
        assert!(index.list_children(None).unwrap().is_empty());

        let page = Page::new("Late Arrival");
        write_page(dir.path(), &page);
        let path = dir
            .path()
            .join(format!("late-arrival-{}.cobble.json", page.id));

        let outcome = index.reindex_file(&path).unwrap();
        assert_eq!(outcome, ReindexOutcome::Indexed);
        assert_eq!(index.list_children(None).unwrap(), vec![page.id]);
    }

    #[test]
    fn reindex_file_updates_rows_in_place_for_a_modified_page() {
        let dir = tempfile::tempdir().unwrap();
        let mut page = Page::new("Draft Title");
        write_page(dir.path(), &page);
        let path = dir
            .path()
            .join(format!("draft-title-{}.cobble.json", page.id));

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();

        page.title = "Final Title".to_string();
        page.blocks
            .push(Block::new(BlockType::Paragraph).with_text("new content"));
        fs::write(&path, serde_json::to_vec(&page).unwrap()).unwrap();

        index.reindex_file(&path).unwrap();

        let hits = index.search_blocks("content").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_id, page.id);

        let title: String = index
            .conn
            .query_row(
                "SELECT title FROM pages WHERE id = ?1",
                [page.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Final Title");
        // Only one row for this page, not a stale one plus a fresh one.
        let count: i64 = index
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE id = ?1",
                [page.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn reindex_file_skips_unreadable_paths_without_erroring() {
        let dir = tempfile::tempdir().unwrap();
        let mut index = Index::open_in_memory().unwrap();
        let outcome = index
            .reindex_file(dir.path().join("does-not-exist-01ARZ3NDEKTSV4RRFFQ69G5FAV.cobble.json"))
            .unwrap();
        assert_eq!(outcome, ReindexOutcome::Skipped);
    }

    #[test]
    fn remove_file_deletes_a_removed_pages_rows_using_only_the_filename() {
        let dir = tempfile::tempdir().unwrap();
        let parent = Page::new("Journal");
        write_page(dir.path(), &parent);
        let mut child = Page::new("Entry");
        child.parent_id = Some(parent.id);
        write_page(dir.path(), &child);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();
        assert_eq!(index.list_children(Some(parent.id)).unwrap(), vec![child.id]);

        let child_path = dir.path().join(format!("entry-{}.cobble.json", child.id));
        fs::remove_file(&child_path).unwrap();
        index.remove_file(&child_path).unwrap();

        assert!(index.list_children(Some(parent.id)).unwrap().is_empty());
        // The parent (and everything else) is untouched.
        assert_eq!(index.list_children(None).unwrap(), vec![parent.id]);
    }

    #[test]
    fn remove_file_is_a_no_op_for_a_path_that_does_not_match_the_page_file_convention() {
        let mut index = Index::open_in_memory().unwrap();
        // Must not panic or error even though this can't map to a page ID.
        index
            .remove_file(Path::new("/tmp/not-a-page-file.txt"))
            .unwrap();
    }

    #[test]
    fn list_children_summaries_returns_the_listing_shape() {
        let dir = tempfile::tempdir().unwrap();
        let mut db_page = Page::new("Tasks");
        db_page.kind = PageKind::Database;
        db_page.icon = Some("clipboard".to_string());
        write_page(dir.path(), &db_page);

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(dir.path()).unwrap();

        let summaries = index.list_children_summaries(None).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, db_page.id);
        assert_eq!(summaries[0].title, "Tasks");
        assert_eq!(summaries[0].icon.as_deref(), Some("clipboard"));
        assert_eq!(summaries[0].kind, PageKind::Database);
        assert_eq!(summaries[0].parent_id, None);
    }

    #[test]
    fn nested_children_are_flattened_with_parent_block_id() {
        let dir = tempfile::tempdir().unwrap();
        let mut page = Page::new("Outline");
        let child = Block::new(BlockType::Todo).with_text("child");
        let mut toggle = Block::new(BlockType::Toggle).with_text("parent");
        toggle.children.push(child.clone());
        page.blocks.push(toggle);
        write_page(dir.path(), &page);

        let mut index = Index::open_in_memory().unwrap();
        let stats = index.rebuild_all(dir.path()).unwrap();
        assert_eq!(stats.blocks_indexed, 2);

        let parent_block_id: Option<String> = index
            .conn
            .query_row(
                "SELECT parent_block_id FROM blocks WHERE id = ?1",
                [child.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(parent_block_id.is_some());
    }
}

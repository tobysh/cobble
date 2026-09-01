use cobble_index::Index;
use cobble_watcher::WatchEvent;

/// Applies a single `cobble-watcher` event to the index — the same
/// operation write commands perform synchronously right after their own
/// write (see the comment above `commands::pages::create_page`), just
/// triggered here by the watcher's own detection of a page file change
/// instead of by the command that caused it. Pulled out of the `setup()`
/// closure in `lib.rs` so it's unit-testable without a running Tauri `App`.
pub fn apply_watch_event(index: &mut Index, event: &WatchEvent) -> cobble_index::Result<()> {
    match event {
        WatchEvent::Created(path) | WatchEvent::Modified(path) => {
            index.reindex_file(path).map(|_| ())
        }
        WatchEvent::Removed(path) => index.remove_file(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cobble_core::{Block, BlockType, Page};
    use cobble_storage::Workspace;
    use std::sync::mpsc::Receiver;
    use std::time::Duration;

    fn recv_event(rx: &Receiver<WatchEvent>) -> WatchEvent {
        rx.recv_timeout(Duration::from_secs(5))
            .expect("expected a watch event within 5s")
    }

    /// End-to-end over the real `cobble-watcher` + `cobble-index` crates
    /// (no Tauri involved): a second `Workspace` handle over the same
    /// directory stands in for some other process editing page files
    /// directly, and we assert the index converges to match without
    /// anything resembling an app restart — just draining events as they
    /// arrive, exactly like the background thread in `lib.rs::run` does.
    #[test]
    fn external_writes_are_picked_up_by_the_watcher_and_reflected_in_the_index() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let pages_dir = workspace.pages_dir();

        let mut index = Index::open_in_memory().unwrap();
        index.rebuild_all(&pages_dir).unwrap();
        assert!(index.list_children(None).unwrap().is_empty());

        let (_watcher, rx) =
            cobble_watcher::PageWatcher::spawn_with_debounce(&pages_dir, Duration::from_millis(50))
                .unwrap();

        // External create.
        let page = Page::new("External Page");
        workspace.write_page(&page).unwrap();
        apply_watch_event(&mut index, &recv_event(&rx)).unwrap();

        assert_eq!(index.list_children(None).unwrap(), vec![page.id]);

        // External modify (title unchanged, so the file path is stable and
        // this collapses to a single `Modified` event).
        let mut updated = page.clone();
        updated
            .blocks
            .push(Block::new(BlockType::Paragraph).with_text("added externally"));
        workspace.write_page(&updated).unwrap();
        apply_watch_event(&mut index, &recv_event(&rx)).unwrap();

        let hits = index.search_blocks("externally").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_id, page.id);

        // External removal (trash_page moves the file out of pages_dir,
        // which the watcher sees the same way it would see a plain delete).
        workspace.trash_page(page.id).unwrap();
        apply_watch_event(&mut index, &recv_event(&rx)).unwrap();

        assert!(index.list_children(None).unwrap().is_empty());
    }
}

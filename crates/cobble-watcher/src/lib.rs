//! `notify`-based filesystem watcher over a pages directory.
//!
//! Watches a single flat directory (per the on-disk layout in `docs/ARCHITECTURE.md`:
//! `pages/<title-slug>-<ulid>.cobble.json`, one file per page) and reports a deduped stream of
//! [`WatchEvent`]s on a channel. Raw `notify` events are debounced, then reconciled against a
//! content-hash cache: a burst of raw events on a path collapses to at most one `WatchEvent`
//! reflecting the net change, and a rewrite that produces byte-identical content (e.g. the
//! app's own save round-tripping through a temp-file-then-rename) produces no event at all.
//! This is what lets `cobble-index` reindex only files that actually changed, per the
//! consistency model described in `docs/ARCHITECTURE.md`.
//!
//! This crate only detects and classifies changes; it has no knowledge of `cobble-index` or
//! `cobble-storage`. Callers drain the returned [`Receiver<WatchEvent>`] and drive their own
//! reindex/query-invalidation logic.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};

/// Suffix identifying a page file within the watched directory; anything else is ignored.
pub const PAGE_FILE_SUFFIX: &str = ".cobble.json";

/// The default debounce window: long enough to coalesce the temp-file-then-rename dance of an
/// atomic write into a single event, short enough that external edits show up promptly.
pub const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(300);

/// A change to a single page file, already deduped against last-known content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchEvent {
    /// A page file exists that wasn't previously known.
    Created(PathBuf),
    /// A previously-known page file's content changed.
    Modified(PathBuf),
    /// A previously-known page file no longer exists.
    Removed(PathBuf),
}

impl WatchEvent {
    pub fn path(&self) -> &Path {
        match self {
            WatchEvent::Created(p) | WatchEvent::Modified(p) | WatchEvent::Removed(p) => p,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WatchError {
    #[error("failed to start filesystem watcher: {0}")]
    Notify(#[from] notify_debouncer_mini::notify::Error),
    #[error("failed to read watch root: {0}")]
    Io(#[from] std::io::Error),
}

/// Handle to a running watcher. Dropping it stops the watch and its background thread.
pub struct PageWatcher {
    _debouncer: notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

impl PageWatcher {
    /// Spawn a watcher over `root` using [`DEFAULT_DEBOUNCE`]. `root` must already exist.
    pub fn spawn(root: impl AsRef<Path>) -> Result<(Self, Receiver<WatchEvent>), WatchError> {
        Self::spawn_with_debounce(root, DEFAULT_DEBOUNCE)
    }

    /// Spawn a watcher over `root` with a custom debounce window. `root` must already exist;
    /// its current page files are hashed up front (not reported as events) so that only
    /// changes going forward are emitted — the caller is expected to have already indexed the
    /// directory's starting state (e.g. via `cobble-index`'s `rebuild_all()`).
    pub fn spawn_with_debounce(
        root: impl AsRef<Path>,
        debounce: Duration,
    ) -> Result<(Self, Receiver<WatchEvent>), WatchError> {
        let root = root.as_ref();
        let known = Arc::new(Mutex::new(seed_known_hashes(root)?));

        let (raw_tx, raw_rx) = mpsc::channel::<DebounceEventResult>();
        let mut debouncer = new_debouncer(debounce, raw_tx)?;
        debouncer
            .watcher()
            .watch(root, RecursiveMode::NonRecursive)?;

        let (out_tx, out_rx) = mpsc::channel::<WatchEvent>();
        thread::spawn(move || {
            while let Ok(result) = raw_rx.recv() {
                let Ok(events) = result else {
                    // Errors from the notify backend aren't tied to a specific path; there's
                    // nothing actionable to reconcile, so just keep listening.
                    continue;
                };
                let mut visited = std::collections::HashSet::with_capacity(events.len());
                for event in events {
                    if !visited.insert(event.path.clone()) {
                        continue;
                    }
                    if let Some(watch_event) = reconcile(&known, &event.path) {
                        if out_tx.send(watch_event).is_err() {
                            return;
                        }
                    }
                }
            }
        });

        Ok((
            PageWatcher {
                _debouncer: debouncer,
            },
            out_rx,
        ))
    }
}

fn is_page_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(PAGE_FILE_SUFFIX))
}

fn seed_known_hashes(root: &Path) -> Result<HashMap<PathBuf, blake3::Hash>, std::io::Error> {
    let mut known = HashMap::new();
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if is_page_file(&path) {
            if let Ok(bytes) = fs::read(&path) {
                known.insert(path, blake3::hash(&bytes));
            }
        }
    }
    Ok(known)
}

/// Compares `path`'s current on-disk state against the last-known hash and returns the
/// [`WatchEvent`] that reconciles them, if any. This is the single source of truth for
/// Created/Modified/Removed classification, so it's robust to however the raw events for a
/// path were batched by the debouncer.
fn reconcile(known: &Mutex<HashMap<PathBuf, blake3::Hash>>, path: &Path) -> Option<WatchEvent> {
    if !is_page_file(path) {
        return None;
    }
    let mut known = known.lock().unwrap();
    match fs::read(path) {
        Ok(bytes) => {
            let hash = blake3::hash(&bytes);
            match known.insert(path.to_path_buf(), hash) {
                Some(prev) if prev == hash => None,
                Some(_) => Some(WatchEvent::Modified(path.to_path_buf())),
                None => Some(WatchEvent::Created(path.to_path_buf())),
            }
        }
        Err(_) => known
            .remove(path)
            .map(|_| WatchEvent::Removed(path.to_path_buf())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_non_page_files() {
        assert!(!is_page_file(Path::new("/pages/notes.txt")));
        assert!(!is_page_file(Path::new("/pages/index.sqlite3")));
        assert!(is_page_file(Path::new(
            "/pages/roadmap-01ARZ3NDEKTSV4RRFFQ69G5FAV.cobble.json"
        )));
    }

    #[test]
    fn reconcile_classifies_create_modify_remove() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("page-01ARZ3.cobble.json");
        let known = Mutex::new(HashMap::new());

        // Doesn't exist yet and isn't known: no event.
        assert_eq!(reconcile(&known, &path), None);

        fs::write(&path, b"{}").unwrap();
        assert_eq!(
            reconcile(&known, &path),
            Some(WatchEvent::Created(path.clone()))
        );

        // Same bytes again: no spurious event.
        assert_eq!(reconcile(&known, &path), None);

        fs::write(&path, b"{\"a\":1}").unwrap();
        assert_eq!(
            reconcile(&known, &path),
            Some(WatchEvent::Modified(path.clone()))
        );

        fs::remove_file(&path).unwrap();
        assert_eq!(
            reconcile(&known, &path),
            Some(WatchEvent::Removed(path.clone()))
        );

        // Already gone: no repeat event.
        assert_eq!(reconcile(&known, &path), None);
    }
}

//! Integration test: write/modify/remove files in a temp dir and confirm a toy index built
//! purely from `WatchEvent`s converges to what's actually on disk. Mirrors the verification
//! approach for this crate described in `docs/ARCHITECTURE.md`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use cobble_watcher::{PageWatcher, WatchEvent};

const RECV_TIMEOUT: Duration = Duration::from_secs(5);

fn recv_one(rx: &Receiver<WatchEvent>) -> WatchEvent {
    rx.recv_timeout(RECV_TIMEOUT)
        .expect("expected a WatchEvent before the timeout")
}

fn recv_none(rx: &Receiver<WatchEvent>) {
    match rx.recv_timeout(Duration::from_millis(600)) {
        Ok(event) => panic!("expected no event, got {event:?}"),
        Err(_) => {}
    }
}

/// Applies an event to a toy in-memory index, the way `cobble-index` will apply them for real.
fn apply(index: &mut HashMap<PathBuf, Vec<u8>>, event: &WatchEvent) {
    match event {
        WatchEvent::Created(path) | WatchEvent::Modified(path) => {
            index.insert(path.clone(), fs::read(path).unwrap());
        }
        WatchEvent::Removed(path) => {
            index.remove(path);
        }
    }
}

#[test]
fn index_converges_to_directory_contents() {
    let dir = tempfile::tempdir().unwrap();

    // A page that exists before the watcher starts should be seeded silently, not reported.
    let existing = dir.path().join("existing-01ARZ3NDEKTSV4RRFFQ69G5FAV.cobble.json");
    fs::write(&existing, b"{\"a\":1}").unwrap();

    let (_watcher, rx) =
        PageWatcher::spawn_with_debounce(dir.path(), Duration::from_millis(50)).unwrap();

    let mut index: HashMap<PathBuf, Vec<u8>> =
        HashMap::from([(existing.clone(), fs::read(&existing).unwrap())]);

    // Non-page files in the same directory must never surface as events.
    fs::write(dir.path().join("notes.txt"), b"irrelevant").unwrap();

    let created = dir.path().join("new-01ARZ4PDEKTSV4RRFFQ69G5FAV.cobble.json");
    fs::write(&created, b"{\"a\":2}").unwrap();
    let event = recv_one(&rx);
    assert_eq!(event, WatchEvent::Created(created.clone()));
    apply(&mut index, &event);

    fs::write(&existing, b"{\"a\":1,\"b\":true}").unwrap();
    let event = recv_one(&rx);
    assert_eq!(event, WatchEvent::Modified(existing.clone()));
    apply(&mut index, &event);

    // Rewriting identical bytes (an atomic-write round trip of unchanged content) must not
    // trigger a reindex.
    fs::write(&existing, b"{\"a\":1,\"b\":true}").unwrap();
    recv_none(&rx);

    fs::remove_file(&created).unwrap();
    let event = recv_one(&rx);
    assert_eq!(event, WatchEvent::Removed(created.clone()));
    apply(&mut index, &event);

    let on_disk: HashSet<PathBuf> = fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".cobble.json"))
        })
        .collect();

    assert_eq!(index.keys().cloned().collect::<HashSet<_>>(), on_disk);
    assert_eq!(index.get(&existing).unwrap(), b"{\"a\":1,\"b\":true}");
}

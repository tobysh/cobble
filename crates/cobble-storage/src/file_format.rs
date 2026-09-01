use crate::slug::slugify;
use cobble_core::{Page, PageId, PropertyValidationError};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use ulid::Ulid;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid page JSON in {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("page {0} not found")]
    PageNotFound(PageId),
    #[error("page {page} failed database schema validation: {source}")]
    SchemaValidation {
        page: PageId,
        #[source]
        source: PropertyValidationError,
    },
}

/// `<title-slug>-<ulid>.cobble.json` — the full ULID (not a shortened form)
/// so a page can be located by filename suffix alone, without parsing every
/// file's JSON (see `Workspace::find_page_path`).
pub fn page_file_name(title: &str, id: PageId) -> String {
    format!("{}-{id}.cobble.json", slugify(title))
}

/// Files are the source of truth (see `docs/ARCHITECTURE.md#file-format--storage`):
/// this must never leave a torn file on disk. Write to a temp file in the same
/// directory, fsync it, then rename over the target — POSIX rename is atomic,
/// so a crash mid-write leaves either the old file or the new one, never a mix.
pub fn write_page_atomic(path: &Path, page: &Page) -> Result<(), StorageError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|source| StorageError::Io {
        path: parent.to_path_buf(),
        source,
    })?;

    let json = serde_json::to_vec_pretty(page).map_err(|source| StorageError::Json {
        path: path.to_path_buf(),
        source,
    })?;

    let tmp_path = tmp_path_for(path);
    write_and_sync(&tmp_path, &json).map_err(|source| StorageError::Io {
        path: tmp_path.clone(),
        source,
    })?;
    fs::rename(&tmp_path, path).map_err(|source| StorageError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(())
}

fn write_and_sync(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn tmp_path_for(path: &Path) -> PathBuf {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!(".{file_name}.{}.tmp", Ulid::new()))
}

pub fn read_page(path: &Path) -> Result<Page, StorageError> {
    let bytes = fs::read(path).map_err(|source| StorageError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_slice(&bytes).map_err(|source| StorageError::Json {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cobble_core::PageKind;

    #[test]
    fn atomic_write_leaves_no_stray_tmp_files() {
        let dir = tempfile::tempdir().unwrap();
        let page = Page::new("Test Page");
        let path = dir.path().join(page_file_name(&page.title, page.id));

        write_page_atomic(&path, &page).unwrap();

        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![path.file_name().unwrap().to_os_string()]);
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let mut page = Page::new("Roundtrip");
        page.kind = PageKind::Database;
        let path = dir.path().join(page_file_name(&page.title, page.id));

        write_page_atomic(&path, &page).unwrap();
        let back = read_page(&path).unwrap();

        assert_eq!(back, page);
    }

    #[test]
    fn round_trips_a_populated_database_schema_through_atomic_write() {
        use cobble_core::{
            DatabaseSchema, DatabaseView, PropertyDefinition, PropertyType, SelectOption,
            TagColor, ViewId, ViewKind,
        };

        let dir = tempfile::tempdir().unwrap();
        let mut page = Page::new("Tasks");
        page.kind = PageKind::Database;
        let mut schema = DatabaseSchema::new(vec![
            PropertyDefinition::new("Name", PropertyType::Text),
            PropertyDefinition::new("Count", PropertyType::Number),
            PropertyDefinition::new("Done", PropertyType::Checkbox),
            PropertyDefinition::new("Due", PropertyType::Date),
            PropertyDefinition::new(
                "Status",
                PropertyType::Select {
                    options: vec![
                        SelectOption::new("Todo", TagColor::Gray),
                        SelectOption::new("Done", TagColor::Green),
                    ],
                },
            ),
            PropertyDefinition::new(
                "Tags",
                PropertyType::MultiSelect {
                    options: vec![SelectOption::new("Bug", TagColor::Red)],
                },
            ),
        ]);
        schema.views.push(DatabaseView {
            id: ViewId::new(),
            name: "Board".into(),
            kind: ViewKind::Board,
        });
        page.database_schema = Some(schema);

        let path = dir.path().join(page_file_name(&page.title, page.id));
        write_page_atomic(&path, &page).unwrap();
        let back = read_page(&path).unwrap();

        assert_eq!(back, page);
    }

    #[test]
    fn overwrite_replaces_content_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let mut page = Page::new("V1");
        let path = dir.path().join(page_file_name(&page.title, page.id));
        write_page_atomic(&path, &page).unwrap();

        page.title = "V1 edited".to_string();
        write_page_atomic(&path, &page).unwrap();

        let back = read_page(&path).unwrap();
        assert_eq!(back.title, "V1 edited");
    }

    #[test]
    fn missing_file_reports_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.cobble.json");
        let err = read_page(&path).unwrap_err();
        assert!(matches!(err, StorageError::Io { path: p, .. } if p == path));
    }

    #[test]
    fn malformed_json_reports_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.cobble.json");
        fs::write(&path, b"not json").unwrap();
        let err = read_page(&path).unwrap_err();
        assert!(matches!(err, StorageError::Json { path: p, .. } if p == path));
    }
}

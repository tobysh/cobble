use crate::file_format::{self, StorageError};
use cobble_core::{Page, PageId};
use std::fs;
use std::path::{Path, PathBuf};

/// A workspace root on disk: `pages/`, `attachments/`, and `.cobble/` (index
/// cache, plugins, trash). See `docs/ARCHITECTURE.md#file-format--storage`
/// for the full layout and the "files are truth" consistency model.
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    /// Creates the directory layout if it doesn't exist yet. Safe to call
    /// against an already-initialized workspace.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, StorageError> {
        let root = root.into();
        for dir in [
            root.join("pages"),
            root.join("attachments"),
            root.join(".cobble").join("trash"),
            root.join(".cobble").join("plugins"),
        ] {
            fs::create_dir_all(&dir).map_err(|source| StorageError::Io { path: dir, source })?;
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn pages_dir(&self) -> PathBuf {
        self.root.join("pages")
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.root.join("attachments")
    }

    fn trash_dir(&self) -> PathBuf {
        self.root.join(".cobble").join("trash")
    }

    /// Writes `page` under a name derived from its title and ID. If the page
    /// already exists on disk under a different name (its title changed
    /// since the last write), the new file is written first and only then
    /// does the stale file get removed — there's never a window where the
    /// page exists under neither name.
    ///
    /// If `page` has a parent that is itself a `kind: Database` page with a
    /// schema, `page.properties` is validated against that schema first (see
    /// `cobble_core::database_schema`'s module docs: "`cobble-storage` calls
    /// the validation functions at the file-write boundary"). Nothing is
    /// written to disk when validation fails.
    pub fn write_page(&self, page: &Page) -> Result<PathBuf, StorageError> {
        self.validate_against_parent_schema(page)?;

        let target = self
            .pages_dir()
            .join(file_format::page_file_name(&page.title, page.id));
        let previous = self.find_page_path(page.id)?;

        file_format::write_page_atomic(&target, page)?;

        if let Some(previous) = previous {
            if previous != target {
                fs::remove_file(&previous).map_err(|source| StorageError::Io {
                    path: previous,
                    source,
                })?;
            }
        }
        Ok(target)
    }

    /// Looks up `page`'s parent on disk and, if it's a database with a
    /// schema, validates `page.properties` against it. A row page whose
    /// parent isn't found (not yet written, already trashed, or simply a
    /// plain `kind: Page`/has no schema) is written unvalidated — schema
    /// enforcement only applies once a page is actually a database row.
    fn validate_against_parent_schema(&self, page: &Page) -> Result<(), StorageError> {
        let Some(parent_id) = page.parent_id else {
            return Ok(());
        };
        let Some(parent) = self.read_page_by_id(parent_id)? else {
            return Ok(());
        };
        let Some(schema) = &parent.database_schema else {
            return Ok(());
        };
        schema
            .validate_row(&page.properties)
            .map_err(|source| StorageError::SchemaValidation {
                page: page.id,
                source,
            })
    }

    pub fn read_page(&self, path: &Path) -> Result<Page, StorageError> {
        file_format::read_page(path)
    }

    pub fn read_page_by_id(&self, id: PageId) -> Result<Option<Page>, StorageError> {
        match self.find_page_path(id)? {
            Some(path) => Ok(Some(self.read_page(&path)?)),
            None => Ok(None),
        }
    }

    /// Locates a page by scanning filenames for the `-<ulid>.cobble.json`
    /// suffix (see `file_format::page_file_name`) — a linear scan, not an
    /// index lookup. This is the storage layer's own fallback; once
    /// `cobble-index` exists, callers needing fast lookups should go through
    /// it instead of this.
    pub fn find_page_path(&self, id: PageId) -> Result<Option<PathBuf>, StorageError> {
        let suffix = format!("-{id}.cobble.json");
        for path in self.list_page_paths()? {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name.ends_with(&suffix) {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    pub fn list_page_paths(&self) -> Result<Vec<PathBuf>, StorageError> {
        let dir = self.pages_dir();
        let entries = fs::read_dir(&dir).map_err(|source| StorageError::Io {
            path: dir.clone(),
            source,
        })?;

        let mut paths = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|source| StorageError::Io {
                path: dir.clone(),
                source,
            })?;
            let path = entry.path();
            if path.to_string_lossy().ends_with(".cobble.json") {
                paths.push(path);
            }
        }
        paths.sort();
        Ok(paths)
    }

    pub fn list_pages(&self) -> Result<Vec<Page>, StorageError> {
        self.list_page_paths()?
            .into_iter()
            .map(|path| self.read_page(&path))
            .collect()
    }

    /// Soft-delete: moves the page's file into `.cobble/trash/`, preserving
    /// its filename. Never a hard delete — restoring is just moving it back.
    pub fn trash_page(&self, id: PageId) -> Result<(), StorageError> {
        let path = self
            .find_page_path(id)?
            .ok_or(StorageError::PageNotFound(id))?;
        let dest = self
            .trash_dir()
            .join(path.file_name().expect("page paths always have a file name"));
        fs::rename(&path, &dest).map_err(|source| StorageError::Io { path, source })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cobble_core::PropertyValue;

    fn open_temp_workspace() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        (dir, workspace)
    }

    #[test]
    fn open_creates_the_expected_layout() {
        let (dir, _workspace) = open_temp_workspace();
        assert!(dir.path().join("pages").is_dir());
        assert!(dir.path().join("attachments").is_dir());
        assert!(dir.path().join(".cobble").join("trash").is_dir());
    }

    #[test]
    fn open_is_idempotent_against_an_existing_workspace() {
        let dir = tempfile::tempdir().unwrap();
        Workspace::open(dir.path()).unwrap();
        Workspace::open(dir.path()).unwrap(); // must not error
    }

    #[test]
    fn write_then_read_by_id_round_trips() {
        let (_dir, workspace) = open_temp_workspace();
        let mut page = Page::new("Q3 Planning");
        page.properties
            .insert("date".into(), PropertyValue::Date("2026-09-01".into()));

        workspace.write_page(&page).unwrap();
        let back = workspace.read_page_by_id(page.id).unwrap().unwrap();

        assert_eq!(back, page);
    }

    #[test]
    fn renaming_the_title_moves_the_file_without_leaving_a_stale_copy() {
        let (_dir, workspace) = open_temp_workspace();
        let mut page = Page::new("Old Title");
        let first_path = workspace.write_page(&page).unwrap();

        page.title = "New Title".to_string();
        let second_path = workspace.write_page(&page).unwrap();

        assert_ne!(first_path, second_path);
        assert!(!first_path.exists());
        assert!(second_path.exists());
        assert_eq!(workspace.list_page_paths().unwrap(), vec![second_path]);
    }

    #[test]
    fn list_pages_returns_every_page_in_the_workspace() {
        let (_dir, workspace) = open_temp_workspace();
        let page_a = Page::new("A");
        let page_b = Page::new("B");
        workspace.write_page(&page_a).unwrap();
        workspace.write_page(&page_b).unwrap();

        let mut pages = workspace.list_pages().unwrap();
        pages.sort_by_key(|p| p.title.clone());

        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].title, "A");
        assert_eq!(pages[1].title, "B");
    }

    #[test]
    fn read_page_by_id_returns_none_when_absent() {
        let (_dir, workspace) = open_temp_workspace();
        assert_eq!(workspace.read_page_by_id(PageId::new()).unwrap(), None);
    }

    #[test]
    fn trash_page_moves_it_out_of_the_pages_dir() {
        let (dir, workspace) = open_temp_workspace();
        let page = Page::new("Doomed");
        workspace.write_page(&page).unwrap();

        workspace.trash_page(page.id).unwrap();

        assert_eq!(workspace.find_page_path(page.id).unwrap(), None);
        let trashed = dir.path().join(".cobble").join("trash");
        let entries: Vec<_> = fs::read_dir(&trashed).unwrap().collect();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn trash_page_errors_for_an_unknown_id() {
        let (_dir, workspace) = open_temp_workspace();
        let err = workspace.trash_page(PageId::new()).unwrap_err();
        assert!(matches!(err, StorageError::PageNotFound(_)));
    }

    fn tasks_database() -> Page {
        use cobble_core::{DatabaseSchema, PropertyDefinition, PropertyType, SelectOption, TagColor};

        let mut db = Page::new("Tasks");
        db.kind = cobble_core::PageKind::Database;
        db.database_schema = Some(DatabaseSchema::new(vec![
            PropertyDefinition::new("Name", PropertyType::Text),
            PropertyDefinition::new("Count", PropertyType::Number),
            PropertyDefinition::new(
                "Status",
                PropertyType::Select {
                    options: vec![
                        SelectOption::new("Todo", TagColor::Gray),
                        SelectOption::new("Done", TagColor::Green),
                    ],
                },
            ),
        ]));
        db
    }

    #[test]
    fn a_database_schema_round_trips_through_the_workspace() {
        let (_dir, workspace) = open_temp_workspace();
        let db = tasks_database();

        workspace.write_page(&db).unwrap();
        let back = workspace.read_page_by_id(db.id).unwrap().unwrap();

        assert_eq!(back.database_schema, db.database_schema);
    }

    #[test]
    fn a_row_page_with_typed_values_round_trips_through_the_workspace() {
        let (_dir, workspace) = open_temp_workspace();
        let db = tasks_database();
        workspace.write_page(&db).unwrap();

        let mut row = Page::new("Ship it");
        row.parent_id = Some(db.id);
        row.properties
            .insert("Name".into(), PropertyValue::Text("Ship it".into()));
        row.properties
            .insert("Count".into(), PropertyValue::Number(3.0));
        row.properties
            .insert("Status".into(), PropertyValue::Select("Todo".into()));
        workspace.write_page(&row).unwrap();

        let back = workspace.read_page_by_id(row.id).unwrap().unwrap();
        assert_eq!(back, row);
    }

    #[test]
    fn writing_a_row_with_a_type_mismatched_value_is_rejected() {
        let (_dir, workspace) = open_temp_workspace();
        let db = tasks_database();
        workspace.write_page(&db).unwrap();

        let mut row = Page::new("Bad row");
        row.parent_id = Some(db.id);
        row.properties
            .insert("Count".into(), PropertyValue::Text("not a number".into()));

        let err = workspace.write_page(&row).unwrap_err();
        assert!(matches!(err, StorageError::SchemaValidation { page, .. } if page == row.id));
        assert_eq!(workspace.read_page_by_id(row.id).unwrap(), None);
    }

    #[test]
    fn writing_a_row_with_an_unknown_select_option_is_rejected() {
        let (_dir, workspace) = open_temp_workspace();
        let db = tasks_database();
        workspace.write_page(&db).unwrap();

        let mut row = Page::new("Bad row");
        row.parent_id = Some(db.id);
        row.properties
            .insert("Status".into(), PropertyValue::Select("Cancelled".into()));

        let err = workspace.write_page(&row).unwrap_err();
        assert!(matches!(err, StorageError::SchemaValidation { page, .. } if page == row.id));
    }

    #[test]
    fn a_row_page_under_a_plain_page_parent_is_written_unvalidated() {
        let (_dir, workspace) = open_temp_workspace();
        let parent = Page::new("Not a database");
        workspace.write_page(&parent).unwrap();

        let mut child = Page::new("Child");
        child.parent_id = Some(parent.id);
        child
            .properties
            .insert("anything".into(), PropertyValue::Text("goes".into()));

        assert!(workspace.write_page(&child).is_ok());
    }

    #[test]
    fn a_page_whose_parent_does_not_exist_on_disk_yet_is_written_unvalidated() {
        let (_dir, workspace) = open_temp_workspace();
        let mut child = Page::new("Orphan");
        child.parent_id = Some(PageId::new());

        assert!(workspace.write_page(&child).is_ok());
    }
}

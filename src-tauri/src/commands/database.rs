use cobble_core::{DatabaseSchema, Page, PageId, PageKind, PropertyDefinition, PropertyValue};
use cobble_index::Index;
use cobble_storage::Workspace;
use tauri::State;

use crate::state::AppState;

// A database is a page (`kind: Database`) carrying a `DatabaseSchema`; a
// database row is a page whose `parent_id` is the database (see
// `crates/cobble-core/src/database_schema.rs`'s module docs). The frontend
// already has `get_page` for the database page itself (schema included) and
// `list_children`/`PageSummary` for cheap tree listings, but a table view
// needs every row's full *typed* `properties` map — `PageSummary`
// deliberately leaves that out since most listing UIs (sidebar, command
// palette) don't need it. These commands are the additive surface for that,
// following the same thin-wrapper-over-`Workspace`/`Index` pattern as
// `commands::pages`.

/// Creates a database page: `kind: Database` carrying a `DatabaseSchema`
/// built from `properties`, with no rows yet. There was previously no way to
/// reach `kind: Database` from the frontend at all (`create_page` always
/// produces a plain `kind: Page`) — without this, nothing could ever
/// exercise `TableView`. `views` starts empty; `m3-*` view tasks add saved
/// views additively later, not through this call.
#[tauri::command]
pub fn create_database(
    state: State<AppState>,
    title: String,
    parent_id: Option<PageId>,
    properties: Vec<PropertyDefinition>,
) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    create_database_impl(&state.workspace, &mut index, title, parent_id, properties)
}

fn create_database_impl(
    workspace: &Workspace,
    index: &mut Index,
    title: String,
    parent_id: Option<PageId>,
    properties: Vec<PropertyDefinition>,
) -> Result<Page, String> {
    let mut page = Page::new(title);
    page.kind = PageKind::Database;
    page.parent_id = parent_id;
    page.database_schema = Some(DatabaseSchema::new(properties));
    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}

/// Every row (full `Page`, typed `properties` included) directly under
/// `database_id`. Uses `cobble-index` for the fast child-ID lookup, then
/// reads each row's current content straight from its file — the same
/// "files are truth" read `get_page` does for one page, just batched over a
/// database's children. Fine at table-view scale (N small file reads); a
/// dedicated `cobble-index` query returning properties in one pass would be
/// the next step if this ever shows up as a bottleneck.
#[tauri::command]
pub fn list_database_rows(state: State<AppState>, database_id: PageId) -> Result<Vec<Page>, String> {
    let index = state.index.lock().map_err(|_| "index lock poisoned")?;
    list_database_rows_impl(&state.workspace, &index, database_id)
}

fn list_database_rows_impl(
    workspace: &Workspace,
    index: &Index,
    database_id: PageId,
) -> Result<Vec<Page>, String> {
    let ids = index
        .list_children(Some(database_id))
        .map_err(|err| err.to_string())?;

    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(page) = workspace.read_page_by_id(id).map_err(|err| err.to_string())? {
            rows.push(page);
        }
    }
    Ok(rows)
}

/// Creates a new row under `database_id` — an ordinary page whose
/// `parent_id` is the database, with no properties set yet (an empty
/// `properties` map always validates against any schema, per
/// `DatabaseSchema::validate_row` skipping keys that aren't present). Cells
/// are filled in afterwards through `update_row_property`.
#[tauri::command]
pub fn create_database_row(
    state: State<AppState>,
    database_id: PageId,
    title: String,
) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    create_database_row_impl(&state.workspace, &mut index, database_id, title)
}

fn create_database_row_impl(
    workspace: &Workspace,
    index: &mut Index,
    database_id: PageId,
    title: String,
) -> Result<Page, String> {
    let mut page = Page::new(title);
    page.parent_id = Some(database_id);
    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}

/// Sets one typed property on a database row, or clears it when `value` is
/// `None`. `Workspace::write_page` validates the new `properties` map
/// against the row's parent database schema before anything touches disk
/// (wrong type, or a select/multi-select value outside the schema's option
/// list, comes back as an `Err` here and the row file is left untouched) —
/// this command doesn't re-implement that check, it just relies on the
/// write boundary that's already there.
#[tauri::command]
pub fn update_row_property(
    state: State<AppState>,
    row_id: PageId,
    name: String,
    value: Option<PropertyValue>,
) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    update_row_property_impl(&state.workspace, &mut index, row_id, name, value)
}

fn update_row_property_impl(
    workspace: &Workspace,
    index: &mut Index,
    row_id: PageId,
    name: String,
    value: Option<PropertyValue>,
) -> Result<Page, String> {
    let mut page = workspace
        .read_page_by_id(row_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("page {row_id} not found"))?;

    match value {
        Some(v) => {
            page.properties.insert(name, v);
        }
        None => {
            page.properties.remove(&name);
        }
    }

    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cobble_core::{DatabaseSchema, PageKind, PropertyDefinition, PropertyType};

    fn open_temp_workspace() -> (tempfile::TempDir, Workspace, Index) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let index = Index::open_in_memory().unwrap();
        (dir, workspace, index)
    }

    fn write_tasks_database(workspace: &Workspace, index: &mut Index) -> PageId {
        let mut db = Page::new("Tasks");
        db.kind = PageKind::Database;
        db.database_schema = Some(DatabaseSchema::new(vec![
            PropertyDefinition::new("Count", PropertyType::Number),
            PropertyDefinition::new("Done", PropertyType::Checkbox),
        ]));
        let path = workspace.write_page(&db).unwrap();
        index.reindex_file(&path).unwrap();
        db.id
    }

    #[test]
    fn create_database_produces_a_database_kind_page_with_the_given_schema() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let db = create_database_impl(
            &workspace,
            &mut index,
            "Tasks".into(),
            None,
            vec![PropertyDefinition::new("Count", PropertyType::Number)],
        )
        .unwrap();

        assert_eq!(db.kind, PageKind::Database);
        let schema = db.database_schema.as_ref().unwrap();
        assert_eq!(schema.properties.len(), 1);
        assert_eq!(schema.properties[0].name, "Count");

        let reloaded = workspace.read_page_by_id(db.id).unwrap().unwrap();
        assert_eq!(reloaded.database_schema, db.database_schema);
    }

    #[test]
    fn list_database_rows_returns_full_rows_with_properties() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let db_id = write_tasks_database(&workspace, &mut index);

        let row = create_database_row_impl(&workspace, &mut index, db_id, "Ship it".into())
            .unwrap();
        let updated = update_row_property_impl(
            &workspace,
            &mut index,
            row.id,
            "Count".into(),
            Some(PropertyValue::Number(3.0)),
        )
        .unwrap();
        assert_eq!(
            updated.properties.get("Count"),
            Some(&PropertyValue::Number(3.0))
        );

        let rows = list_database_rows_impl(&workspace, &index, db_id).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, row.id);
        assert_eq!(
            rows[0].properties.get("Count"),
            Some(&PropertyValue::Number(3.0))
        );
    }

    #[test]
    fn list_database_rows_is_empty_for_a_database_with_no_rows() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let db_id = write_tasks_database(&workspace, &mut index);
        assert!(list_database_rows_impl(&workspace, &index, db_id)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn update_row_property_rejects_a_value_the_schema_does_not_allow() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let db_id = write_tasks_database(&workspace, &mut index);
        let row = create_database_row_impl(&workspace, &mut index, db_id, "Bad row".into())
            .unwrap();

        let err = update_row_property_impl(
            &workspace,
            &mut index,
            row.id,
            "Count".into(),
            Some(PropertyValue::Text("nope".into())),
        )
        .unwrap_err();
        assert!(err.contains("Count"));

        // Rejected write must not have touched the row's persisted properties.
        let reloaded = workspace.read_page_by_id(row.id).unwrap().unwrap();
        assert!(reloaded.properties.get("Count").is_none());
    }

    #[test]
    fn update_row_property_with_none_clears_the_property() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let db_id = write_tasks_database(&workspace, &mut index);
        let row = create_database_row_impl(&workspace, &mut index, db_id, "Row".into()).unwrap();
        update_row_property_impl(
            &workspace,
            &mut index,
            row.id,
            "Done".into(),
            Some(PropertyValue::Checkbox(true)),
        )
        .unwrap();

        let cleared =
            update_row_property_impl(&workspace, &mut index, row.id, "Done".into(), None).unwrap();
        assert!(cleared.properties.get("Done").is_none());
    }

    #[test]
    fn update_row_property_errors_for_an_unknown_row() {
        let (_dir, workspace, mut index) = open_temp_workspace();
        let err = update_row_property_impl(
            &workspace,
            &mut index,
            PageId::new(),
            "Count".into(),
            Some(PropertyValue::Number(1.0)),
        )
        .unwrap_err();
        assert!(err.contains("not found"));
    }
}

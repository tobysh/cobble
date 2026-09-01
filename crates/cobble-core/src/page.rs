use crate::block::Block;
use crate::id::PageId;
use crate::property::PropertyValue;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Bumped whenever the on-disk page shape changes in a way readers must
/// branch on. `cobble-storage` is the only crate that should ever inspect
/// this for migration purposes.
pub const CURRENT_FORMAT_VERSION: u32 = 1;

/// A database is a page (`kind: Database`) carrying `database_schema`; a
/// database row is a page whose `parent_id` is the database and whose
/// `properties["_schema_ref"]` points back at it (see
/// `docs/ARCHITECTURE.md#file-format--storage`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageKind {
    Page,
    Database,
}

/// One page on disk: `pages/<title-slug>-<ulid>.cobble.json`. Tree structure
/// lives in `parent_id`, not the file path, so moves/renames never touch
/// other files.
///
/// `database_schema` is left as opaque JSON here rather than a typed shape —
/// `database_schema + typed properties read/write` is M3 work; `cobble-core`
/// only needs to preserve the field untouched through M1/M2 round-trips.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    pub format_version: u32,
    pub id: PageId,
    pub kind: PageKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<PageId>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, PropertyValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_schema: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<Block>,
}

impl Page {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            format_version: CURRENT_FORMAT_VERSION,
            id: PageId::new(),
            kind: PageKind::Page,
            parent_id: None,
            title: title.into(),
            icon: None,
            properties: BTreeMap::new(),
            database_schema: None,
            blocks: Vec::new(),
        }
    }

    /// The reserved `date` property that powers the global calendar, if set.
    pub fn date(&self) -> Option<&str> {
        match self.properties.get("date") {
            Some(PropertyValue::Date(d)) => Some(d.as_str()),
            _ => None,
        }
    }

    /// The reserved `_is_daily_note` flag (see
    /// `docs/ARCHITECTURE.md#global-calendar--daily-notes`).
    pub fn is_daily_note(&self) -> bool {
        matches!(
            self.properties.get("_is_daily_note"),
            Some(PropertyValue::Checkbox(true))
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::BlockType;

    #[test]
    fn round_trips_a_minimal_page_through_json() {
        let mut page = Page::new("Untitled");
        page.blocks.push(Block::new(BlockType::Paragraph).with_text("hi"));

        let json = serde_json::to_string(&page).unwrap();
        let back: Page = serde_json::from_str(&json).unwrap();
        assert_eq!(back, page);
    }

    #[test]
    fn byte_stable_on_reserialize() {
        let page = Page::new("Daily Note");
        let first = serde_json::to_string(&page).unwrap();
        let parsed: Page = serde_json::from_str(&first).unwrap();
        let second = serde_json::to_string(&parsed).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn reads_reserved_date_and_daily_note_properties() {
        let mut page = Page::new("2026-09-01");
        page.properties.insert(
            "date".into(),
            PropertyValue::Date("2026-09-01".into()),
        );
        page.properties
            .insert("_is_daily_note".into(), PropertyValue::Checkbox(true));

        assert_eq!(page.date(), Some("2026-09-01"));
        assert!(page.is_daily_note());
    }

    #[test]
    fn a_database_page_preserves_opaque_schema_json() {
        let mut page = Page::new("Tasks");
        page.kind = PageKind::Database;
        page.database_schema = Some(serde_json::json!({ "properties": {}, "views": [] }));

        let json = serde_json::to_string(&page).unwrap();
        let back: Page = serde_json::from_str(&json).unwrap();
        assert_eq!(back, page);
    }
}

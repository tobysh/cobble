//! Typed schema for database pages (M3). A database is a page (`kind:
//! Database`) carrying a `DatabaseSchema`, which declares named+typed
//! columns — Notion's "database properties" — plus saved views. A database
//! row is a page whose `parent_id` is the database (see
//! `docs/ARCHITECTURE.md#file-format--storage`); its `Page::properties`
//! entries are validated against the matching `PropertyDefinition` here via
//! [`DatabaseSchema::validate_value`] / [`DatabaseSchema::validate_row`].
//!
//! This module is pure data + pure validation logic — no I/O (see "cobble-core
//! has no I/O" in `CLAUDE.md`). `cobble-storage` calls the validation
//! functions at the file-write boundary; it owns looking the parent database
//! page up on disk and turning a validation failure into a `StorageError`.

use crate::id::ViewId;
use crate::property::PropertyValue;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A semantic tag color — never a raw hex/hsl/rgb value (see "Theme tokens
/// only" in `CLAUDE.md`). The frontend maps each variant to a `--tag-*`
/// token in `frontend/src/theme/tokens.css`, defined per `light`/`dark`
/// (real hue, mirroring Notion's own tag palette) and `night` (desaturated
/// onto the monochrome ramp). Plugin UI can never reach this type directly —
/// only `UiSchemaRenderer`'s semantic widget vocabulary — so it can't smuggle
/// a raw color through a database view either.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TagColor {
    Gray,
    Brown,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
    Pink,
    Red,
}

/// One option in a `Select`/`MultiSelect` property's fixed value list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectOption {
    pub name: String,
    pub color: TagColor,
}

impl SelectOption {
    pub fn new(name: impl Into<String>, color: TagColor) -> Self {
        Self {
            name: name.into(),
            color,
        }
    }
}

/// The type of one database column, and any type-specific config needed to
/// validate/render it. Mirrors `PropertyValue`'s variant set for the types
/// that make sense as a declared column; `Relation` isn't included yet since
/// referential validation (does the target page exist / belong to the right
/// database) is out of scope for this pass.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "config", rename_all = "snake_case")]
pub enum PropertyType {
    Text,
    Number,
    Checkbox,
    /// ISO 8601 (`yyyy-mm-dd`, or a full datetime) — same shape as
    /// `PropertyValue::Date`.
    Date,
    /// A single value out of `options`, rendered as a colored tag.
    Select { options: Vec<SelectOption> },
    /// Zero or more values out of `options`, each rendered as a colored tag.
    MultiSelect { options: Vec<SelectOption> },
}

impl PropertyType {
    /// A short, human-readable name for error messages (`"text"`,
    /// `"select"`, ...) — matches `PropertyValue`'s own `#[serde(tag =
    /// "type")]` spelling.
    fn label(&self) -> &'static str {
        match self {
            PropertyType::Text => "text",
            PropertyType::Number => "number",
            PropertyType::Checkbox => "checkbox",
            PropertyType::Date => "date",
            PropertyType::Select { .. } => "select",
            PropertyType::MultiSelect { .. } => "multi_select",
        }
    }

    fn options(&self) -> Option<&[SelectOption]> {
        match self {
            PropertyType::Select { options } | PropertyType::MultiSelect { options } => {
                Some(options)
            }
            _ => None,
        }
    }
}

/// One named+typed column on a database. `name` matches the key used in a
/// row's `Page::properties` map (renaming a column is renaming this field —
/// there's no separate stable property ID yet).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyDefinition {
    pub name: String,
    pub property_type: PropertyType,
}

impl PropertyDefinition {
    pub fn new(name: impl Into<String>, property_type: PropertyType) -> Self {
        Self {
            name: name.into(),
            property_type,
        }
    }
}

/// Which built-in view a saved view renders as. Board/list/gallery/calendar
/// views land in their own M3 tasks (see `TASKS.md`); this schema only needs
/// the container shape today so `database_schema` round-trips the full
/// on-disk shape described in `docs/ARCHITECTURE.md#file-format--storage`
/// ("typed property defs + saved `views[]`").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewKind {
    Table,
    Board,
    List,
    Gallery,
    Calendar,
}

/// A saved view over a database. Deliberately minimal — filter/sort/group
/// config is `m3-filter-sort-group-query-builder` and each view-kind task's
/// job to add, additively, to this struct.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DatabaseView {
    pub id: ViewId,
    pub name: String,
    pub kind: ViewKind,
}

/// A database's typed schema: its column definitions plus saved views. This
/// is what `Page::database_schema` holds for a `kind: Database` page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DatabaseSchema {
    pub properties: Vec<PropertyDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub views: Vec<DatabaseView>,
}

/// Why a `PropertyValue` doesn't satisfy a `DatabaseSchema`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PropertyValidationError {
    #[error("no property named {0:?} is defined on this database")]
    UnknownProperty(String),
    #[error("property {name:?} is typed {expected}, but got a {actual} value")]
    TypeMismatch {
        name: String,
        expected: &'static str,
        actual: &'static str,
    },
    #[error("{value:?} is not one of property {name:?}'s options")]
    UnknownOption { name: String, value: String },
}

impl DatabaseSchema {
    pub fn new(properties: Vec<PropertyDefinition>) -> Self {
        Self {
            properties,
            views: Vec::new(),
        }
    }

    /// Looks up a column definition by name.
    pub fn property(&self, name: &str) -> Option<&PropertyDefinition> {
        self.properties.iter().find(|p| p.name == name)
    }

    /// Validates a single row property value against the matching column
    /// definition. Pure — takes the schema and value, does no I/O; the
    /// caller (`cobble-storage`, at the write boundary) is responsible for
    /// having loaded the parent database's schema first.
    pub fn validate_value(
        &self,
        name: &str,
        value: &PropertyValue,
    ) -> Result<(), PropertyValidationError> {
        let def = self
            .property(name)
            .ok_or_else(|| PropertyValidationError::UnknownProperty(name.to_string()))?;

        let actual = value_label(value);
        let expected = def.property_type.label();

        let type_matches = matches!(
            (&def.property_type, value),
            (PropertyType::Text, PropertyValue::Text(_))
                | (PropertyType::Number, PropertyValue::Number(_))
                | (PropertyType::Checkbox, PropertyValue::Checkbox(_))
                | (PropertyType::Date, PropertyValue::Date(_))
                | (PropertyType::Select { .. }, PropertyValue::Select(_))
                | (PropertyType::MultiSelect { .. }, PropertyValue::MultiSelect(_))
        );
        if !type_matches {
            return Err(PropertyValidationError::TypeMismatch {
                name: name.to_string(),
                expected,
                actual,
            });
        }

        match (&def.property_type, value) {
            (PropertyType::Select { .. }, PropertyValue::Select(chosen)) => {
                let options = def.property_type.options().unwrap_or(&[]);
                if !options.iter().any(|o| &o.name == chosen) {
                    return Err(PropertyValidationError::UnknownOption {
                        name: name.to_string(),
                        value: chosen.clone(),
                    });
                }
            }
            (PropertyType::MultiSelect { .. }, PropertyValue::MultiSelect(chosen)) => {
                let options = def.property_type.options().unwrap_or(&[]);
                for value in chosen {
                    if !options.iter().any(|o| &o.name == value) {
                        return Err(PropertyValidationError::UnknownOption {
                            name: name.to_string(),
                            value: value.clone(),
                        });
                    }
                }
            }
            _ => {}
        }

        Ok(())
    }

    /// Validates every entry in a row's `properties` map that matches a
    /// defined column, in a stable (name-sorted) order so the first failure
    /// reported is deterministic. Keys with no matching column definition
    /// (reserved keys like `date`/`_is_daily_note`, or ad-hoc per-page
    /// properties — see `cobble-core::property`'s docs) are skipped, not
    /// rejected: the typed-schema system layers on top of the existing
    /// per-page property system rather than replacing it.
    pub fn validate_row(
        &self,
        properties: &BTreeMap<String, PropertyValue>,
    ) -> Result<(), PropertyValidationError> {
        for (name, value) in properties {
            if self.property(name).is_some() {
                self.validate_value(name, value)?;
            }
        }
        Ok(())
    }
}

fn value_label(value: &PropertyValue) -> &'static str {
    match value {
        PropertyValue::Text(_) => "text",
        PropertyValue::Number(_) => "number",
        PropertyValue::Checkbox(_) => "checkbox",
        PropertyValue::Date(_) => "date",
        PropertyValue::Select(_) => "select",
        PropertyValue::MultiSelect(_) => "multi_select",
        PropertyValue::Relation(_) => "relation",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tasks_schema() -> DatabaseSchema {
        DatabaseSchema::new(vec![
            PropertyDefinition::new("Name", PropertyType::Text),
            PropertyDefinition::new("Count", PropertyType::Number),
            PropertyDefinition::new("Done", PropertyType::Checkbox),
            PropertyDefinition::new("Due", PropertyType::Date),
            PropertyDefinition::new(
                "Status",
                PropertyType::Select {
                    options: vec![
                        SelectOption::new("Todo", TagColor::Gray),
                        SelectOption::new("Doing", TagColor::Blue),
                        SelectOption::new("Done", TagColor::Green),
                    ],
                },
            ),
            PropertyDefinition::new(
                "Tags",
                PropertyType::MultiSelect {
                    options: vec![
                        SelectOption::new("Bug", TagColor::Red),
                        SelectOption::new("Feature", TagColor::Purple),
                    ],
                },
            ),
        ])
    }

    #[test]
    fn accepts_a_matching_value_for_every_property_type() {
        let schema = tasks_schema();
        assert!(schema
            .validate_value("Name", &PropertyValue::Text("hi".into()))
            .is_ok());
        assert!(schema
            .validate_value("Count", &PropertyValue::Number(3.0))
            .is_ok());
        assert!(schema
            .validate_value("Done", &PropertyValue::Checkbox(true))
            .is_ok());
        assert!(schema
            .validate_value("Due", &PropertyValue::Date("2026-09-01".into()))
            .is_ok());
        assert!(schema
            .validate_value("Status", &PropertyValue::Select("Doing".into()))
            .is_ok());
        assert!(schema
            .validate_value(
                "Tags",
                &PropertyValue::MultiSelect(vec!["Bug".into(), "Feature".into()])
            )
            .is_ok());
    }

    #[test]
    fn rejects_a_text_value_for_a_number_column() {
        let schema = tasks_schema();
        let err = schema
            .validate_value("Count", &PropertyValue::Text("nope".into()))
            .unwrap_err();
        assert_eq!(
            err,
            PropertyValidationError::TypeMismatch {
                name: "Count".into(),
                expected: "number",
                actual: "text",
            }
        );
    }

    #[test]
    fn rejects_a_select_value_outside_the_option_list() {
        let schema = tasks_schema();
        let err = schema
            .validate_value("Status", &PropertyValue::Select("Cancelled".into()))
            .unwrap_err();
        assert_eq!(
            err,
            PropertyValidationError::UnknownOption {
                name: "Status".into(),
                value: "Cancelled".into(),
            }
        );
    }

    #[test]
    fn rejects_a_multi_select_value_outside_the_option_list() {
        let schema = tasks_schema();
        let err = schema
            .validate_value("Tags", &PropertyValue::MultiSelect(vec!["Bug".into(), "Chore".into()]))
            .unwrap_err();
        assert_eq!(
            err,
            PropertyValidationError::UnknownOption {
                name: "Tags".into(),
                value: "Chore".into(),
            }
        );
    }

    #[test]
    fn rejects_a_value_for_a_property_the_schema_does_not_define() {
        let schema = tasks_schema();
        let err = schema
            .validate_value("Nonexistent", &PropertyValue::Text("x".into()))
            .unwrap_err();
        assert_eq!(
            err,
            PropertyValidationError::UnknownProperty("Nonexistent".into())
        );
    }

    #[test]
    fn validate_row_skips_reserved_and_ad_hoc_keys_not_in_the_schema() {
        let schema = tasks_schema();
        let mut row = BTreeMap::new();
        row.insert("Name".into(), PropertyValue::Text("Ship it".into()));
        row.insert("date".into(), PropertyValue::Date("2026-09-01".into()));
        row.insert("_is_daily_note".into(), PropertyValue::Checkbox(false));
        row.insert("scratch".into(), PropertyValue::Text("not a column".into()));

        assert!(schema.validate_row(&row).is_ok());
    }

    #[test]
    fn validate_row_rejects_a_bad_value_on_a_defined_column() {
        let schema = tasks_schema();
        let mut row = BTreeMap::new();
        row.insert("Name".into(), PropertyValue::Text("ok".into()));
        row.insert("Count".into(), PropertyValue::Checkbox(true));

        let err = schema.validate_row(&row).unwrap_err();
        assert_eq!(
            err,
            PropertyValidationError::TypeMismatch {
                name: "Count".into(),
                expected: "number",
                actual: "checkbox",
            }
        );
    }

    #[test]
    fn schema_round_trips_through_json_including_views() {
        let mut schema = tasks_schema();
        schema.views.push(DatabaseView {
            id: ViewId::new(),
            name: "Board".into(),
            kind: ViewKind::Board,
        });

        let json = serde_json::to_string(&schema).unwrap();
        let back: DatabaseSchema = serde_json::from_str(&json).unwrap();
        assert_eq!(back, schema);
    }
}

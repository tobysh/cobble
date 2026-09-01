use crate::id::PageId;
use serde::{Deserialize, Serialize};

/// A typed page property value. `cobble-index` mirrors these into its
/// `properties` table (indexed on `value_date` for the global calendar); the
/// two reserved keys `date` and `_is_daily_note` (see
/// `docs/ARCHITECTURE.md#global-calendar--daily-notes`) are ordinary entries
/// in a `Page::properties` map using `Date` and `Checkbox` respectively —
/// there's no separate reserved-key type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum PropertyValue {
    Text(String),
    Number(f64),
    Checkbox(bool),
    /// ISO 8601 (`yyyy-mm-dd`, or a full datetime).
    Date(String),
    Select(String),
    MultiSelect(Vec<String>),
    Relation(Vec<PageId>),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_each_variant_through_json() {
        let values = vec![
            PropertyValue::Text("hello".into()),
            PropertyValue::Number(3.5),
            PropertyValue::Checkbox(true),
            PropertyValue::Date("2026-09-01".into()),
            PropertyValue::Select("todo".into()),
            PropertyValue::MultiSelect(vec!["a".into(), "b".into()]),
            PropertyValue::Relation(vec![PageId::new(), PageId::new()]),
        ];

        for value in values {
            let json = serde_json::to_string(&value).unwrap();
            let back: PropertyValue = serde_json::from_str(&json).unwrap();
            assert_eq!(back, value);
        }
    }

    #[test]
    fn date_shape_matches_the_reserved_calendar_key_format() {
        let json = serde_json::to_string(&PropertyValue::Date("2026-09-01".into())).unwrap();
        assert_eq!(json, r#"{"type":"date","value":"2026-09-01"}"#);
    }
}

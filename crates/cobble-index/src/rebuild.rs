use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use cobble_core::{Block, Page, PropertyValue};
use rusqlite::{params, Connection};

use crate::error::Result;
use crate::schema;

/// Outcome of a `rebuild_all()` pass. `skipped` holds files that failed to
/// parse — a rescan is a recovery path, so one corrupt page file shouldn't
/// abort indexing every other page.
#[derive(Debug, Default)]
pub struct RebuildStats {
    pub pages_indexed: usize,
    pub blocks_indexed: usize,
    pub skipped: Vec<(PathBuf, String)>,
}

fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Rescans every `*.cobble.json` file directly under `pages_dir` (the
/// on-disk format is a flat directory — tree structure lives in `parent_id`,
/// not the path) and repopulates the index from scratch.
pub fn rebuild_all(conn: &mut Connection, pages_dir: &Path) -> Result<RebuildStats> {
    let mut stats = RebuildStats::default();

    let tx = conn.transaction()?;
    schema::clear_all(&tx)?;

    let mut entries: Vec<PathBuf> = match fs::read_dir(pages_dir) {
        Ok(dir) => dir
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.ends_with(".cobble.json"))
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    entries.sort();

    for path in entries {
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                stats.skipped.push((path, e.to_string()));
                continue;
            }
        };

        let page: Page = match serde_json::from_slice(&bytes) {
            Ok(p) => p,
            Err(e) => {
                stats.skipped.push((path, e.to_string()));
                continue;
            }
        };

        let hash = content_hash(&bytes);
        insert_page(&tx, &page, &path, &hash)?;
        stats.pages_indexed += 1;
        stats.blocks_indexed += count_blocks(&page.blocks);
    }

    tx.commit()?;
    Ok(stats)
}

fn count_blocks(blocks: &[Block]) -> usize {
    blocks.iter().map(|b| 1 + count_blocks(&b.children)).sum()
}

fn insert_page(conn: &Connection, page: &Page, path: &Path, hash: &str) -> Result<()> {
    let id = page.id.to_string();
    let kind = match page.kind {
        cobble_core::PageKind::Page => "page",
        cobble_core::PageKind::Database => "database",
    };

    conn.execute(
        "INSERT INTO pages (id, kind, parent_id, title, icon, format_version, file_path, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            kind,
            page.parent_id.map(|p| p.to_string()),
            page.title,
            page.icon,
            page.format_version,
            path.to_string_lossy(),
            hash,
        ],
    )?;

    if let Some(schema_json) = &page.database_schema {
        conn.execute(
            "INSERT INTO database_schemas (page_id, schema_json) VALUES (?1, ?2)",
            params![id, schema_json.to_string()],
        )?;
    }

    for (key, value) in &page.properties {
        insert_property(conn, &id, key, value)?;
    }

    for (position, block) in page.blocks.iter().enumerate() {
        insert_block(conn, &id, None, position as i64, block)?;
    }

    Ok(())
}

fn insert_property(
    conn: &Connection,
    page_id: &str,
    key: &str,
    value: &PropertyValue,
) -> Result<()> {
    let (value_type, value_text, value_number, value_bool, value_date): (
        &str,
        Option<String>,
        Option<f64>,
        Option<i64>,
        Option<String>,
    ) = match value {
        PropertyValue::Text(s) => ("text", Some(s.clone()), None, None, None),
        PropertyValue::Number(n) => ("number", None, Some(*n), None, None),
        PropertyValue::Checkbox(b) => ("checkbox", None, None, Some(*b as i64), None),
        PropertyValue::Date(d) => ("date", None, None, None, Some(d.clone())),
        PropertyValue::Select(s) => ("select", Some(s.clone()), None, None, None),
        PropertyValue::MultiSelect(items) => (
            "multi_select",
            Some(serde_json::to_string(items).unwrap_or_default()),
            None,
            None,
            None,
        ),
        PropertyValue::Relation(ids) => {
            let id_strings: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
            for target in &id_strings {
                conn.execute(
                    "INSERT INTO links (source_page_id, source_block_id, target_page_id, kind)
                     VALUES (?1, NULL, ?2, 'relation')",
                    params![page_id, target],
                )?;
            }
            (
                "relation",
                Some(serde_json::to_string(&id_strings).unwrap_or_default()),
                None,
                None,
                None,
            )
        }
    };

    conn.execute(
        "INSERT INTO properties (page_id, key, value_type, value_text, value_number, value_bool, value_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![page_id, key, value_type, value_text, value_number, value_bool, value_date],
    )?;

    Ok(())
}

fn insert_block(
    conn: &Connection,
    page_id: &str,
    parent_block_id: Option<&str>,
    position: i64,
    block: &Block,
) -> Result<()> {
    let id = block.id.to_string();
    let block_type = serde_json::to_value(block.block_type)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let text: String = block
        .content
        .iter()
        .map(|span| span.text.as_str())
        .collect();
    let attrs = serde_json::Value::Object(block.attrs.clone()).to_string();

    conn.execute(
        "INSERT INTO blocks (id, page_id, parent_block_id, position, block_type, text, attrs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            page_id,
            parent_block_id,
            position,
            block_type,
            text,
            attrs
        ],
    )?;

    conn.execute(
        "INSERT INTO blocks_fts (block_id, page_id, text) VALUES (?1, ?2, ?3)",
        params![id, page_id, text],
    )?;

    // Sub-page blocks are how one page links to another via the block tree.
    // `attrs` is loose JSON (cobble-core doesn't type per-block-type attrs
    // yet), so this is a best-effort convention, not a hard contract: a
    // `linked_page_id` attr that doesn't parse as a ULID is just not indexed
    // as a backlink rather than failing the whole rebuild.
    if block.block_type == cobble_core::BlockType::SubPage {
        if let Some(target) = block.attrs.get("linked_page_id").and_then(|v| v.as_str()) {
            if target.parse::<cobble_core::PageId>().is_ok() {
                conn.execute(
                    "INSERT INTO links (source_page_id, source_block_id, target_page_id, kind)
                     VALUES (?1, ?2, ?3, 'sub_page')",
                    params![page_id, id, target],
                )?;
            }
        }
    }

    for (child_position, child) in block.children.iter().enumerate() {
        insert_block(
            conn,
            page_id,
            Some(id.as_str()),
            child_position as i64,
            child,
        )?;
    }

    Ok(())
}

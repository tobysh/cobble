use cobble_core::{BlockId, PageId};
use rusqlite::{params, Connection};

use crate::error::Result;

/// A single FTS5 hit against the flattened block text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub block_id: BlockId,
    pub page_id: PageId,
    pub text: String,
}

/// Pages whose `parent_id` matches, ordered by title. `None` returns
/// top-level pages (no parent).
pub fn list_children(conn: &Connection, parent_id: Option<PageId>) -> Result<Vec<PageId>> {
    let mut stmt =
        conn.prepare("SELECT id FROM pages WHERE parent_id IS ?1 ORDER BY title COLLATE NOCASE")?;
    let rows = stmt.query_map(params![parent_id.map(|p| p.to_string())], |row| {
        row.get::<_, String>(0)
    })?;

    rows.map(|r| Ok(parse_page_id(r?)))
        .collect::<Result<Vec<_>>>()
}

/// Pages carrying a reserved `date` property whose value falls in
/// `[start, end]` (inclusive, ISO 8601 lexical comparison) — powers the
/// global calendar.
pub fn pages_with_date_between(conn: &Connection, start: &str, end: &str) -> Result<Vec<PageId>> {
    let mut stmt = conn.prepare(
        "SELECT page_id FROM properties
         WHERE key = 'date' AND value_date BETWEEN ?1 AND ?2
         ORDER BY value_date",
    )?;
    let rows = stmt.query_map(params![start, end], |row| row.get::<_, String>(0))?;

    rows.map(|r| Ok(parse_page_id(r?)))
        .collect::<Result<Vec<_>>>()
}

/// Full-text search over flattened block text. `query` is treated as plain
/// user text, never FTS5 match syntax — each whitespace-separated token is
/// quoted (with embedded `"` doubled, FTS5's own escape) before it reaches
/// `MATCH`, so input like `AND OR NEAR( *` searches for those literal words
/// instead of being parsed as query operators.
pub fn search_blocks(conn: &Connection, query: &str) -> Result<Vec<SearchHit>> {
    let sanitized = sanitize_fts5_query(query);
    if sanitized.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt =
        conn.prepare("SELECT block_id, page_id, text FROM blocks_fts WHERE blocks_fts MATCH ?1")?;
    let rows = stmt.query_map(params![sanitized], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut hits = Vec::new();
    for row in rows {
        let (block_id, page_id, text) = row?;
        hits.push(SearchHit {
            block_id: parse_block_id(block_id),
            page_id: parse_page_id(page_id),
            text,
        });
    }
    Ok(hits)
}

/// Pages that reference `target` — via a `relation` property or a
/// `sub_page` block.
pub fn backlinks(conn: &Connection, target: PageId) -> Result<Vec<PageId>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT source_page_id FROM links WHERE target_page_id = ?1 ORDER BY source_page_id",
    )?;
    let rows = stmt.query_map(params![target.to_string()], |row| row.get::<_, String>(0))?;

    rows.map(|r| Ok(parse_page_id(r?)))
        .collect::<Result<Vec<_>>>()
}

/// Turns raw user search text into an FTS5 match expression that can only
/// ever mean "AND these literal words together" — no token is ever passed
/// through unquoted, so none of FTS5's own syntax (`AND`/`OR`/`NOT`,
/// `NEAR(...)`, `*` prefix wildcards, column filters) is reachable from
/// search input.
fn sanitize_fts5_query(raw: &str) -> String {
    raw.split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_page_id(s: String) -> PageId {
    s.parse()
        .expect("pages.id column always holds a valid ULID written by rebuild_all")
}

fn parse_block_id(s: String) -> BlockId {
    s.parse()
        .expect("blocks.id column always holds a valid ULID written by rebuild_all")
}

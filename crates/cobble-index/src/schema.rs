use rusqlite::Connection;

use crate::error::Result;

/// Creates every derived-index table if it doesn't already exist. Idempotent
/// and safe to call on every `Index::open()` — this is a cache, not a
/// migration target; `rebuild_all()` is the recovery path if the shape here
/// ever changes, not an in-place `ALTER TABLE`.
pub fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = OFF;

        CREATE TABLE IF NOT EXISTS pages (
            id              TEXT PRIMARY KEY,
            kind            TEXT NOT NULL,
            parent_id       TEXT,
            title           TEXT NOT NULL,
            icon            TEXT,
            format_version  INTEGER NOT NULL,
            file_path       TEXT NOT NULL,
            content_hash    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);

        CREATE TABLE IF NOT EXISTS blocks (
            id               TEXT PRIMARY KEY,
            page_id          TEXT NOT NULL,
            parent_block_id  TEXT,
            position         INTEGER NOT NULL,
            block_type       TEXT NOT NULL,
            text             TEXT NOT NULL,
            attrs            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_blocks_page_id ON blocks(page_id);
        CREATE INDEX IF NOT EXISTS idx_blocks_parent_block_id ON blocks(parent_block_id);

        CREATE TABLE IF NOT EXISTS properties (
            page_id      TEXT NOT NULL,
            key          TEXT NOT NULL,
            value_type   TEXT NOT NULL,
            value_text   TEXT,
            value_number REAL,
            value_bool   INTEGER,
            value_date   TEXT,
            PRIMARY KEY (page_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_properties_value_date ON properties(value_date);
        CREATE INDEX IF NOT EXISTS idx_properties_key ON properties(key);

        CREATE TABLE IF NOT EXISTS database_schemas (
            page_id     TEXT PRIMARY KEY,
            schema_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS links (
            source_page_id  TEXT NOT NULL,
            source_block_id TEXT,
            target_page_id  TEXT NOT NULL,
            kind            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_page_id);
        CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_page_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
            block_id UNINDEXED,
            page_id UNINDEXED,
            text
        );
        ",
    )?;
    Ok(())
}

/// Wipes every derived table's rows, leaving the schema in place. Called at
/// the start of `rebuild_all()` so a stale/corrupt index doesn't leave
/// orphaned rows behind after a rescan.
pub fn clear_all(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        DELETE FROM pages;
        DELETE FROM blocks;
        DELETE FROM properties;
        DELETE FROM database_schemas;
        DELETE FROM links;
        DELETE FROM blocks_fts;
        ",
    )?;
    Ok(())
}

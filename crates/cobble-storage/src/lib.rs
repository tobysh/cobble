//! On-disk file format and atomic read/write for Cobble pages. Files are the
//! source of truth (see "Files are truth, SQLite is a cache" in `CLAUDE.md`);
//! `cobble-index` is the only crate that should treat SQLite as more than a
//! rebuildable cache derived from what's in here.

mod file_format;
mod slug;
mod workspace;

pub use file_format::{page_file_name, read_page, write_page_atomic, StorageError};
pub use workspace::Workspace;

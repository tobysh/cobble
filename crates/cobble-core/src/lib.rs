//! Domain types for Cobble's page/block content model. No I/O — see
//! "cobble-core has no I/O" in `CLAUDE.md`. File reads/writes belong in
//! `cobble-storage`; SQL belongs in `cobble-index`.

mod block;
mod id;
mod page;
mod property;

pub use block::{Block, BlockType, InlineSpan, Mark};
pub use id::{BlockId, PageId};
pub use page::{Page, PageKind, CURRENT_FORMAT_VERSION};
pub use property::PropertyValue;

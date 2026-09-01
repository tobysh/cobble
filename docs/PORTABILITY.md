# Portability: could `.md` + frontmatter replace `.cobble.json`?

M2.5 investigation. Grounded in the current format: `crates/cobble-core/src/page.rs`,
`block.rs`, `property.rs`, and `crates/cobble-storage/src/file_format.rs`. See
`docs/ARCHITECTURE.md#file-format--storage` for the canonical shape.

## Current format, briefly

One JSON file per page (`pages/<slug>-<ulid>.cobble.json`):
`{format_version, id, kind, parent_id, title, icon, properties, database_schema, blocks[]}`.
Every block has a stable ULID (`id.rs`) and is a recursive tree:
`{id, type, attrs, content: InlineSpan[], children[]}`. `PropertyValue` is a tagged
enum (`Text`, `Number`, `Checkbox`, `Date`, `Select`, `MultiSelect`, `Relation(Vec<PageId>)`).
A database is a page with `database_schema`; a row is a page whose `parent_id` points
at it. Writes are atomic (temp file + fsync + rename).

## What maps cleanly to `.md` + YAML frontmatter

- **Title** — either the frontmatter `title:` key or the `# Heading`/filename.
- **Simple scalar properties** — `Text`, `Number`, `Checkbox`, `Date`, `Select` are
  exactly what YAML frontmatter is for (`status: Done`, `due: 2026-09-01`).
  `MultiSelect` maps to a YAML list.
- **Top-level flowing text** — paragraphs, headings, simple lists, blockquotes,
  inline bold/italic/code/links (`Mark` variants) are a direct match for CommonMark.
  This is the case Markdown was built for and Cobble's own `InlineSpan`/`Mark` model
  already mirrors it (comment in `block.rs` calls out the Lexical text-node parity).

## What's awkward or lossy

- **Block IDs.** Every block needs a *stable* ULID — relations, links, and plugin
  data all address blocks by ID (per `CLAUDE.md`: "Block IDs are forever"). Markdown
  has no native per-block identity; the only way to keep IDs is an inline extension
  (e.g. an HTML comment or trailing attribute per block: `<!-- id: 01H... -->`), which
  is invisible/fragile in a plain text editor and defeats the "just Markdown" premise.
  A hand-edit that reorders or duplicates a paragraph would silently orphan or collide
  IDs unless the ID marker survives byte-for-byte.
- **Nested/rich blocks.** `Toggle` and its `children[]`, `Table`, and arbitrary block
  nesting don't have a clean, universally-supported Markdown representation — GFM
  tables are 2D grids only, not Cobble's general block tree; toggles have no standard
  syntax at all.
- **`PluginBlock`.** `attrs: {plugin_id, block_type, data}` is arbitrary JSON today.
  It would have to be fenced (```` ```plugin-block ```` code fence with embedded JSON)
  — round-trips fine but reads exactly like an escape hatch, not "real" Markdown, and
  a user hand-editing the fence contents can desync `data` from what the plugin expects.
- **`Relation` and any future rollup/formula property.** `PropertyValue::Relation(Vec<PageId>)`
  needs to reference other pages by stable ID; frontmatter can hold a list of ULIDs
  but loses the human-friendly title (Notion's own Markdown export has this exact
  problem — relation properties export as opaque IDs or broken links). A rollup or
  formula property (if added later, per property.rs's tagged-enum design) is *derived*
  and has no sensible frontmatter representation at all — it isn't a stored value.
- **Images.** Binary asset references (paths, possibly future embedded/attachment
  data) fit `![]()` syntax fine for the read path, but on write there's no natural
  place to keep block-level attrs like alt/caption/size beyond overloading Markdown's
  limited image syntax.
- **Database schema.** `DatabaseSchema` (typed property defs, `views[]` with view
  kind/config) has no Markdown analogue whatsoever — this alone would have to stay a
  JSON (or YAML) blob, frontmatter or sidecar, even in an otherwise-Markdown scheme.
- **Byte-stable round-tripping.** `page.rs` has an explicit test
  (`byte_stable_on_reserialize`) guaranteeing JSON serialize→parse→serialize is
  identical — important for clean diffs and avoiding spurious file-watcher churn.
  Markdown has many equally-valid renderings of the same content (list markers,
  wrapping, escaping); guaranteeing byte-stability through arbitrary hand-edits is
  much harder than with a canonical JSON serializer.

## Recommendation: hybrid, not a wholesale replacement — and not now

Don't adopt `.md`+frontmatter as the primary on-disk format. Too much of Cobble's
committed data model (stable block IDs, relations, database schemas, plugin data)
has no faithful Markdown representation, and the "files are truth" principle
(`CLAUDE.md`) depends on the file being the *complete, unambiguous* source — a lossy
export format undermines that if it's also the source of truth.

What's worth doing, later, as an **additive, one-way export/import feature** (not a
storage-format change):
- **Export**: generate a `.md` file per simple `Page` (kind: `Page`, no database
  rows, no relations, no plugin blocks) for interop with other tools / human
  reading outside Cobble. Best-effort: drop or fence what doesn't map.
- **Import**: read a `.md` file with YAML frontmatter as a *new* page — scalar
  frontmatter keys become properties, body becomes blocks, fresh ULIDs assigned.
  One-way; not expected to round-trip back to Markdown byte-stable.

This keeps `.cobble.json` as the sole source of truth (satisfying the ULID-stability
and files-are-truth requirements) while giving portability where it's actually
useful — plain-text notes and simple pages — without pretending Markdown can carry
the full data model.

## Migration considerations if this changes later

If a future milestone decided to go further (e.g. Markdown becomes the format for
*simple* pages only, JSON reserved for database pages / anything with relations):
- Would need a per-page format flag so mixed workspaces are legal during rollout.
- Block ID preservation would need to be solved first and separately (e.g. a
  reserved comment convention), or IDs would need to be treated as ephemeral for
  Markdown-backed pages — a breaking change to the "block IDs are forever" guarantee
  that would need its own small, fast, clearly-flagged task per `CLAUDE.md`'s
  cobble-core change process.
- `cobble-watcher`/`cobble-index` would need a second parser path, and `cobble-storage`
  would need to detect format by extension/content rather than assuming JSON.

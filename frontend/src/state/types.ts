export type Theme = 'light' | 'dark' | 'night'

// ---- IDs -------------------------------------------------------------
// Both are ULIDs on the Rust side (`cobble_core::{PageId, BlockId}`), sent
// over Tauri IPC as plain strings (`#[serde(transparent)]`).
export type PageId = string
export type BlockId = string

// ---- Block / Page domain model ----------------------------------------
// Mirrors `crates/cobble-core/src/{block,page,property}.rs` field-for-field
// (including `snake_case` variant names) so these types can be passed to/from
// `invoke()` without a translation layer for the block tree itself — the only
// mapping that happens is in `state/api.ts`, for the handful of page-level
// fields (`parent_id` -> `parentId`, and the reserved `date` /
// `_is_daily_note` properties -> flat `date` / `isDailyNote` convenience
// fields) that the UI reads far more often than raw `properties`.

export type PageKind = 'page' | 'database'

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'code'
  | 'divider'
  | 'table'
  | 'image'
  | 'sub_page'
  | 'plugin_block'

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'strikethrough' }
  | { type: 'code' }
  | { type: 'link'; href: string }

/** A run of text sharing the same marks — mirrors `cobble_core::InlineSpan`. */
export interface InlineSpan {
  text: string
  marks?: Mark[]
}

/**
 * One block. `attrs` carries type-specific data as loose JSON, exactly like
 * the Rust side (`checked` for `todo`, `level` for `heading` — the frontend's
 * own convention, since `cobble-core` leaves the key open). The M1 editor
 * (`editor/`) only ever produces `paragraph` / `heading` / `todo` / `divider`
 * blocks; the rest of the vocabulary exists so future block types round-trip
 * untouched instead of being dropped.
 */
export interface Block {
  id: BlockId
  type: BlockType
  attrs?: Record<string, unknown>
  content?: InlineSpan[]
  children?: Block[]
}

export type PropertyValue =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'checkbox'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'select'; value: string }
  | { type: 'multi_select'; value: string[] }
  | { type: 'relation'; value: PageId[] }

// ---- Database schema (M3) ----------------------------------------------
// Mirrors `crates/cobble-core/src/database_schema.rs` field-for-field. A
// database is a page (`kind: 'database'`) whose `databaseSchema` is set; a
// database row is a page whose `parentId` is that database, with typed
// values in its own `properties` map (the same `PropertyValue` used above)
// keyed by `PropertyDefinition.name`.

/**
 * A semantic tag color — never a raw hex/hsl/rgb (see "Theme tokens only" in
 * CLAUDE.md). Maps 1:1 to a `--tag-<color>`/`--tag-<color>-soft` pair in
 * `frontend/src/theme/tokens.css`; nothing in `database/` should ever read a
 * color off a row/option any other way.
 */
export type TagColor = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'

export interface SelectOption {
  name: string
  color: TagColor
}

/** One database column's type, plus its type-specific config (`select`/`multi_select` only). */
export type PropertyType =
  | { type: 'text' }
  | { type: 'number' }
  | { type: 'checkbox' }
  | { type: 'date' }
  | { type: 'select'; config: { options: SelectOption[] } }
  | { type: 'multi_select'; config: { options: SelectOption[] } }

/** One named+typed column on a database. `name` matches a row's `properties` key. */
export interface PropertyDefinition {
  name: string
  propertyType: PropertyType
}

export type ViewKind = 'table' | 'board' | 'list' | 'gallery' | 'calendar'

export interface DatabaseView {
  id: string
  name: string
  kind: ViewKind
}

export interface DatabaseSchema {
  properties: PropertyDefinition[]
  views: DatabaseView[]
}

/**
 * UI-facing page shape. Field-compatible with the old mock `Page` (`id`,
 * `title`, `icon`, `blocks`, `date`, `isDailyNote`) so `Sidebar`,
 * `CalendarView`, and `CommandPalette` didn't need to change — `date` /
 * `isDailyNote` are populated from the backend's `properties` map by
 * `state/api.ts`, not stored flat on disk.
 */
export interface Page {
  id: PageId
  parentId: PageId | null
  kind: PageKind
  title: string
  icon: string
  blocks: Block[]
  formatVersion: number
  properties: Record<string, PropertyValue>
  date?: string
  isDailyNote?: boolean
  /** Set only for `kind: 'database'` pages — see the "Database schema" section above. */
  databaseSchema?: DatabaseSchema
}

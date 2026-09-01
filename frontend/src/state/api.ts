import { invoke } from '@tauri-apps/api/core'
import type { Block, DatabaseSchema, Page, PageId, PageKind, PropertyDefinition, PropertyValue } from './types'

// Thin wrapper around the Tauri commands in `src-tauri/src/commands/pages.rs`
// (`create_page` / `get_page` / `update_page_blocks` / `list_children` /
// `move_page` / `delete_page`). Tauri camelCases Rust snake_case argument
// names for the JS side automatically (`parent_id` -> `parentId` etc.) — the
// keys below match that convention, not the Rust source.
//
// Two shapes cross this boundary:
//  - `Block[]` is passed straight through unchanged (see the comment on
//    `Block` in `state/types.ts` — it's already a 1:1 mirror of
//    `cobble_core::Block`).
//  - `Page`/`PageSummary` get mapped: the backend's `snake_case` DTO becomes
//    the UI-facing camelCase `Page` in `state/types.ts`, and the reserved
//    `date` / `_is_daily_note` properties are lifted into flat convenience
//    fields so `CalendarView`/`Sidebar`/`CommandPalette` don't need to know
//    about the `properties` map at all.

// Raw on-disk shape of `cobble_core::database_schema::PropertyDefinition` —
// snake_case `property_type` key, unlike the UI-facing `PropertyDefinition`
// in `state/types.ts` (Tauri only camelCases *command argument* names, not
// arbitrary struct field names in a response body, so this still needs the
// same manual mapping `fromBackendPage` already does for `Page` itself).
interface BackendPropertyDefinition {
  name: string
  property_type: PropertyDefinition['propertyType']
}

interface BackendDatabaseSchema {
  properties: BackendPropertyDefinition[]
  views?: DatabaseSchema['views']
}

interface BackendPage {
  format_version: number
  id: PageId
  kind: PageKind
  parent_id?: PageId | null
  title: string
  icon?: string | null
  properties?: Record<string, PropertyValue>
  database_schema?: BackendDatabaseSchema | null
  blocks: Block[]
}

interface BackendPageSummary {
  id: PageId
  parent_id: PageId | null
  kind: PageKind
  title: string
  icon: string | null
}

const DEFAULT_ICON = '📄'
const DEFAULT_DATABASE_ICON = '🗄️'

function defaultIconFor(kind: PageKind): string {
  return kind === 'database' ? DEFAULT_DATABASE_ICON : DEFAULT_ICON
}

function dateFromProperties(props?: Record<string, PropertyValue>): string | undefined {
  const prop = props?.date
  return prop?.type === 'date' ? prop.value : undefined
}

function isDailyNoteFromProperties(props?: Record<string, PropertyValue>): boolean {
  const prop = props?._is_daily_note
  return prop?.type === 'checkbox' ? prop.value : false
}

function fromBackendDatabaseSchema(schema?: BackendDatabaseSchema | null): DatabaseSchema | undefined {
  if (!schema) return undefined
  return {
    properties: schema.properties.map((p) => ({ name: p.name, propertyType: p.property_type })),
    views: schema.views ?? [],
  }
}

function fromBackendPage(p: BackendPage): Page {
  return {
    id: p.id,
    parentId: p.parent_id ?? null,
    kind: p.kind,
    title: p.title,
    icon: p.icon ?? defaultIconFor(p.kind),
    blocks: p.blocks ?? [],
    formatVersion: p.format_version,
    properties: p.properties ?? {},
    date: dateFromProperties(p.properties),
    isDailyNote: isDailyNoteFromProperties(p.properties),
    databaseSchema: fromBackendDatabaseSchema(p.database_schema),
  }
}

function fromBackendSummary(p: BackendPageSummary): Page {
  return {
    id: p.id,
    parentId: p.parent_id,
    kind: p.kind,
    title: p.title,
    icon: p.icon ?? defaultIconFor(p.kind),
    blocks: [],
    formatVersion: 1,
    properties: {},
  }
}

export const api = {
  async createPage(title: string, parentId: PageId | null): Promise<Page> {
    const page = await invoke<BackendPage>('create_page', { title, parentId })
    return fromBackendPage(page)
  },

  async getPage(id: PageId): Promise<Page | null> {
    const page = await invoke<BackendPage | null>('get_page', { id })
    return page ? fromBackendPage(page) : null
  },

  async updatePageBlocks(id: PageId, blocks: Block[]): Promise<Page> {
    const page = await invoke<BackendPage>('update_page_blocks', { id, blocks })
    return fromBackendPage(page)
  },

  async listChildren(parentId: PageId | null): Promise<Page[]> {
    const summaries = await invoke<BackendPageSummary[]>('list_children', { parentId })
    return summaries.map(fromBackendSummary)
  },

  async movePage(id: PageId, newParentId: PageId | null): Promise<Page> {
    const page = await invoke<BackendPage>('move_page', { id, newParentId })
    return fromBackendPage(page)
  },

  async deletePage(id: PageId): Promise<void> {
    await invoke<void>('delete_page', { id })
  },

  async renamePage(id: PageId, title: string): Promise<Page> {
    const page = await invoke<BackendPage>('rename_page', { id, title })
    return fromBackendPage(page)
  },

  // ---- Databases (see `src-tauri/src/commands/database.rs`) ------------

  async createDatabase(title: string, parentId: PageId | null, properties: PropertyDefinition[]): Promise<Page> {
    const page = await invoke<BackendPage>('create_database', {
      title,
      parentId,
      properties: properties.map((p) => ({ name: p.name, property_type: p.propertyType })),
    })
    return fromBackendPage(page)
  },

  async listDatabaseRows(databaseId: PageId): Promise<Page[]> {
    const rows = await invoke<BackendPage[]>('list_database_rows', { databaseId })
    return rows.map(fromBackendPage)
  },

  async createDatabaseRow(databaseId: PageId, title: string): Promise<Page> {
    const page = await invoke<BackendPage>('create_database_row', { databaseId, title })
    return fromBackendPage(page)
  },

  /** `value: null` clears the property instead of setting it. */
  async updateRowProperty(rowId: PageId, name: string, value: PropertyValue | null): Promise<Page> {
    const page = await invoke<BackendPage>('update_row_property', { rowId, name, value })
    return fromBackendPage(page)
  },
}

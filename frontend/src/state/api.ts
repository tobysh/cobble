import { invoke } from '@tauri-apps/api/core'
import type { Block, Page, PageId, PageKind, PropertyValue } from './types'

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

interface BackendPage {
  format_version: number
  id: PageId
  kind: PageKind
  parent_id?: PageId | null
  title: string
  icon?: string | null
  properties?: Record<string, PropertyValue>
  database_schema?: unknown
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

function dateFromProperties(props?: Record<string, PropertyValue>): string | undefined {
  const prop = props?.date
  return prop?.type === 'date' ? prop.value : undefined
}

function isDailyNoteFromProperties(props?: Record<string, PropertyValue>): boolean {
  const prop = props?._is_daily_note
  return prop?.type === 'checkbox' ? prop.value : false
}

function fromBackendPage(p: BackendPage): Page {
  return {
    id: p.id,
    parentId: p.parent_id ?? null,
    kind: p.kind,
    title: p.title,
    icon: p.icon ?? DEFAULT_ICON,
    blocks: p.blocks ?? [],
    formatVersion: p.format_version,
    properties: p.properties ?? {},
    date: dateFromProperties(p.properties),
    isDailyNote: isDailyNoteFromProperties(p.properties),
  }
}

function fromBackendSummary(p: BackendPageSummary): Page {
  return {
    id: p.id,
    parentId: p.parent_id,
    kind: p.kind,
    title: p.title,
    icon: p.icon ?? DEFAULT_ICON,
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

  /**
   * Backed by `src-tauri/src/commands/plugins.rs::check_custom_ui_permission`
   * — re-parses `manifestToml` host-side and checks it against
   * `cobble_plugin_host::permissions::Permission::CustomUi`. This is the
   * authoritative half of the `custom_ui` iframe escape hatch's
   * deny-by-default gate (see `plugin-runtime/CustomUiFrame.tsx`): a plugin
   * whose manifest doesn't grant `custom_ui` gets `false` back no matter
   * what any client-side state says, and a malformed manifest rejects the
   * request outright rather than silently resolving either way.
   */
  async checkCustomUiPermission(manifestToml: string): Promise<boolean> {
    return invoke<boolean>('check_custom_ui_permission', { manifestToml })
  },
}

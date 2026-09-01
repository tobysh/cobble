import { create } from 'zustand'
import { api } from './api'
import { newUlid } from './ulid'
import type { Block, Page, PageId, Theme } from './types'

// Sentinel key used in `children`/`expandedTree` for the workspace root,
// since the backend's root parent is `null` (no id to key a JS object with).
const ROOT_KEY = 'root'
const JOURNAL_TITLE = 'Journal'

type View =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'page'; pageId: PageId }
  | { kind: 'calendar' }

interface WorkspaceState {
  theme: Theme
  setTheme: (theme: Theme) => void

  pages: Record<PageId, Page>
  children: Record<string, PageId[]>

  view: View
  openPage: (pageId: PageId) => void
  openCalendar: () => void

  expandedTree: Set<string>
  toggleTreeExpanded: (pageId: PageId) => void

  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void

  loadWorkspace: () => Promise<void>

  /** Persists a page's full block tree through `update_page_blocks`. */
  saveBlocks: (pageId: PageId, blocks: Block[]) => Promise<void>

  /**
   * Local-only for now: `pages.rs` has no rename/update-title command (only
   * `update_page_blocks`, which never touches `title`), so an edit here does
   * not survive an app restart. See the PR description for this gap.
   */
  updatePageTitle: (pageId: PageId, title: string) => void

  createPage: (parentId: PageId | null, title: string) => Promise<PageId>
  createDailyNote: (dateISO: string, label: string) => Promise<PageId>
  deletePage: (pageId: PageId) => Promise<void>
}

function childKey(parentId: PageId | null): string {
  return parentId ?? ROOT_KEY
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  pages: {},
  children: {},

  view: { kind: 'loading' },
  openPage: (pageId) => set({ view: { kind: 'page', pageId }, paletteOpen: false }),
  openCalendar: () => set({ view: { kind: 'calendar' }, paletteOpen: false }),

  expandedTree: new Set(),
  toggleTreeExpanded: (pageId) =>
    set((s) => {
      const next = new Set(s.expandedTree)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return { expandedTree: next }
    }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  // Walks the whole page tree via `list_children`, then fetches each page's
  // full content via `get_page` (blocks + properties, which `list_children`'s
  // lighter-weight `PageSummary` doesn't carry). N+1 IPC round trips, fine at
  // M1's workspace scale — a real `cobble-index` "list all pages with
  // properties" query would replace this once that surface exists (see the
  // sibling `agent/cobble-index-watcher-wiring` work).
  loadWorkspace: async () => {
    const pages: Record<PageId, Page> = {}
    const children: Record<string, PageId[]> = {}

    async function walk(parentId: PageId | null): Promise<void> {
      const summaries = await api.listChildren(parentId)
      children[childKey(parentId)] = summaries.map((s) => s.id)
      await Promise.all(
        summaries.map(async (summary) => {
          const full = await api.getPage(summary.id)
          if (full) pages[summary.id] = full
          await walk(summary.id)
        }),
      )
    }

    await walk(null)

    const rootIds = children[ROOT_KEY] ?? []
    set({
      pages,
      children,
      view: rootIds.length > 0 ? { kind: 'page', pageId: rootIds[0] } : { kind: 'empty' },
    })
  },

  saveBlocks: async (pageId, blocks) => {
    const saved = await api.updatePageBlocks(pageId, blocks)
    set((s) => {
      const existing = s.pages[pageId]
      if (!existing) return s
      // Keep the client-side title edit (see `updatePageTitle`) — the
      // backend response's `title` is whatever was last written to disk,
      // which `update_page_blocks` never changes, so this is just carrying
      // forward the freshest blocks/properties.
      return { pages: { ...s.pages, [pageId]: { ...existing, blocks: saved.blocks, properties: saved.properties } } }
    })
  },

  updatePageTitle: (pageId, title) =>
    set((s) => {
      const page = s.pages[pageId]
      if (!page) return s
      return { pages: { ...s.pages, [pageId]: { ...page, title } } }
    }),

  createPage: async (parentId, title) => {
    const page = await api.createPage(title, parentId)
    set((s) => {
      const key = childKey(parentId)
      const next = new Set(s.expandedTree)
      if (parentId) next.add(parentId)
      return {
        pages: { ...s.pages, [page.id]: page },
        children: { ...s.children, [key]: [...(s.children[key] ?? []), page.id] },
        expandedTree: next,
      }
    })
    get().openPage(page.id)
    return page.id
  },

  // No backend command sets page `properties` (see `updatePageTitle`'s
  // comment — `create_page` only takes `title`/`parent_id`), so the `date` /
  // `_is_daily_note` markers used to find a daily note again are annotated
  // client-side only. They're lost on restart, at which point this will
  // create a duplicate note for the same day instead of reopening it — a
  // real fix needs a backend command that can write `properties` at
  // creation (or a follow-up `update_page_properties`).
  createDailyNote: async (dateISO, label) => {
    const state = get()
    const rootIds = state.children[ROOT_KEY] ?? []
    let journalId = rootIds.find((id) => state.pages[id]?.title === JOURNAL_TITLE)

    if (!journalId) {
      journalId = await state.createPage(null, JOURNAL_TITLE)
    }

    const journalChildren = get().children[journalId] ?? []
    const existing = journalChildren.find((id) => get().pages[id]?.date === dateISO)
    if (existing) {
      get().openPage(existing)
      return existing
    }

    const page = await api.createPage(label, journalId)
    const annotated: Page = { ...page, date: dateISO, isDailyNote: true }
    const headingBlock: Block = {
      id: newUlid(),
      type: 'heading',
      attrs: { level: 2 },
      content: [{ text: label }],
    }
    const paragraphBlock: Block = { id: newUlid(), type: 'paragraph', content: [{ text: '' }] }
    const saved = await api.updatePageBlocks(page.id, [headingBlock, paragraphBlock])

    set((s) => ({
      pages: { ...s.pages, [page.id]: { ...annotated, blocks: saved.blocks } },
      children: { ...s.children, [journalId!]: [...journalChildren, page.id] },
      expandedTree: new Set(s.expandedTree).add(journalId!),
    }))
    get().openPage(page.id)
    return page.id
  },

  deletePage: async (pageId) => {
    const state = get()
    const page = state.pages[pageId]
    if (!page) return

    // Cascade: `trash_page` only moves the one file, but leaving its
    // children pointed at a now-trashed parent would orphan them from the
    // tree (they'd stop showing up under any `list_children` call), so trash
    // the whole subtree from the UI side.
    const toDelete: PageId[] = []
    const collect = (id: PageId) => {
      toDelete.push(id)
      for (const childId of state.children[id] ?? []) collect(childId)
    }
    collect(pageId)

    await Promise.all(toDelete.map((id) => api.deletePage(id)))

    set((s) => {
      const pages = { ...s.pages }
      const children = { ...s.children }
      for (const id of toDelete) {
        delete pages[id]
        delete children[id]
      }
      const parentKey = childKey(page.parentId)
      children[parentKey] = (children[parentKey] ?? []).filter((id) => id !== pageId)

      const view =
        s.view.kind === 'page' && toDelete.includes(s.view.pageId)
          ? children[ROOT_KEY]?.length
            ? { kind: 'page' as const, pageId: children[ROOT_KEY][0] }
            : { kind: 'empty' as const }
          : s.view

      return { pages, children, view }
    })
  },
}))

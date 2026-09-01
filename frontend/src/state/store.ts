import { create } from 'zustand'
import { CHILDREN, PAGES, nextId } from './mockData'
import type { Block, BlockType, Page, Theme } from './types'

type View = { kind: 'page'; pageId: string } | { kind: 'calendar' }

interface WorkspaceState {
  theme: Theme
  setTheme: (theme: Theme) => void

  pages: Record<string, Page>
  children: Record<string, string[]>

  view: View
  openPage: (pageId: string) => void
  openCalendar: () => void

  expandedTree: Set<string>
  toggleTreeExpanded: (pageId: string) => void

  expandedBlocks: Set<string>
  toggleBlockExpanded: (blockId: string) => void

  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void

  toggleTodo: (pageId: string, blockPath: number[]) => void
  updateBlockText: (pageId: string, blockPath: number[], text: string) => void
  insertBlockAfter: (pageId: string, blockPath: number[], type: BlockType) => void
  setBlockType: (pageId: string, blockPath: number[], type: BlockType) => void
  updateTableCell: (pageId: string, blockPath: number[], row: number, col: number, text: string) => void

  updatePageTitle: (pageId: string, title: string) => void
  createPage: (parentId: string, title: string) => string
  createDailyNote: (dateISO: string, label: string) => string
}

function mapBlockAtPath(
  blocks: Block[],
  path: number[],
  fn: (b: Block) => Block,
): Block[] {
  const [head, ...rest] = path
  return blocks.map((b, i) => {
    if (i !== head) return b
    if (rest.length === 0) return fn(b)
    return { ...b, children: mapBlockAtPath(b.children ?? [], rest, fn) }
  })
}

function insertAfterPath(blocks: Block[], path: number[], newBlock: Block): Block[] {
  const [head, ...rest] = path
  if (rest.length === 0) {
    const copy = blocks.slice()
    copy.splice(head + 1, 0, newBlock)
    return copy
  }
  return blocks.map((b, i) =>
    i === head ? { ...b, children: insertAfterPath(b.children ?? [], rest, newBlock) } : b,
  )
}

const emptyBlockOfType = (type: BlockType): Block => ({
  id: nextId('blk'),
  type,
  text: '',
  ...(type === 'todo' ? { checked: false } : {}),
  ...(type === 'table' ? { rows: [['', '', '']] } : {}),
})

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  pages: PAGES,
  children: CHILDREN,

  view: { kind: 'page', pageId: 'pg_welcome' },
  openPage: (pageId) => set({ view: { kind: 'page', pageId }, paletteOpen: false }),
  openCalendar: () => set({ view: { kind: 'calendar' }, paletteOpen: false }),

  expandedTree: new Set(['pg_roadmap', 'pg_journal']),
  toggleTreeExpanded: (pageId) =>
    set((s) => {
      const next = new Set(s.expandedTree)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return { expandedTree: next }
    }),

  expandedBlocks: new Set(),
  toggleBlockExpanded: (blockId) =>
    set((s) => {
      const next = new Set(s.expandedBlocks)
      if (next.has(blockId)) next.delete(blockId)
      else next.add(blockId)
      return { expandedBlocks: next }
    }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  toggleTodo: (pageId, blockPath) =>
    set((s) => {
      const page = s.pages[pageId]
      if (!page) return s
      const blocks = mapBlockAtPath(page.blocks, blockPath, (b) => ({ ...b, checked: !b.checked }))
      return { pages: { ...s.pages, [pageId]: { ...page, blocks } } }
    }),

  updateBlockText: (pageId, blockPath, text) =>
    set((s) => {
      const page = s.pages[pageId]
      if (!page) return s
      const blocks = mapBlockAtPath(page.blocks, blockPath, (b) => ({ ...b, text }))
      return { pages: { ...s.pages, [pageId]: { ...page, blocks } } }
    }),

  insertBlockAfter: (pageId, blockPath, type) =>
    set((s) => {
      const page = s.pages[pageId]
      if (!page) return s
      const blocks = insertAfterPath(page.blocks, blockPath, emptyBlockOfType(type))
      return { pages: { ...s.pages, [pageId]: { ...page, blocks } } }
    }),

  setBlockType: (pageId, blockPath, type) =>
    set((s) => {
      const page = s.pages[pageId]
      if (!page) return s
      const blocks = mapBlockAtPath(page.blocks, blockPath, (b) => ({
        ...emptyBlockOfType(type),
        id: b.id,
        children: b.children,
      }))
      return { pages: { ...s.pages, [pageId]: { ...page, blocks } } }
    }),

  updateTableCell: (pageId, blockPath, row, col, text) =>
    set((s) => {
      const page = s.pages[pageId]
      if (!page) return s
      const blocks = mapBlockAtPath(page.blocks, blockPath, (b) => {
        const rows = (b.rows ?? []).map((r) => r.slice())
        if (rows[row]) rows[row][col] = text
        return { ...b, rows }
      })
      return { pages: { ...s.pages, [pageId]: { ...page, blocks } } }
    }),

  updatePageTitle: (pageId, title) =>
    set((s) => {
      const page = s.pages[pageId]
      if (!page) return s
      return { pages: { ...s.pages, [pageId]: { ...page, title } } }
    }),

  createPage: (parentId, title) => {
    const id = nextId('pg')
    set((s) => ({
      pages: {
        ...s.pages,
        [id]: {
          id,
          title,
          icon: '📄',
          blocks: [{ id: nextId('blk'), type: 'heading', headingLevel: 1, text: title }],
        },
      },
      children: {
        ...s.children,
        [parentId]: [...(s.children[parentId] ?? []), id],
      },
      expandedTree: new Set(s.expandedTree).add(parentId),
    }))
    get().openPage(id)
    return id
  },

  createDailyNote: (dateISO, label) => {
    const existing = Object.values(get().pages).find((p) => p.isDailyNote && p.date === dateISO)
    if (existing) {
      get().openPage(existing.id)
      return existing.id
    }
    const id = nextId('pg')
    set((s) => ({
      pages: {
        ...s.pages,
        [id]: {
          id,
          title: label,
          icon: '📅',
          date: dateISO,
          isDailyNote: true,
          blocks: [
            { id: nextId('blk'), type: 'heading', headingLevel: 2, text: label },
            { id: nextId('blk'), type: 'paragraph', text: '' },
          ],
        },
      },
      children: {
        ...s.children,
        pg_journal: [...(s.children.pg_journal ?? []), id],
      },
      expandedTree: new Set(s.expandedTree).add('pg_journal'),
    }))
    get().openPage(id)
    return id
  },
}))

import type { Block, Page } from './types'

// Static demo content — the real page tree will come from cobble-storage /
// cobble-index over Tauri `invoke()` once M1 lands (see TASKS.md). This file
// exists purely so the UI has something believable to render.

let counter = 0
const id = (prefix: string) => `${prefix}_${(counter++).toString(36)}`

const block = (b: Omit<Block, 'id'>): Block => ({ id: id('blk'), ...b })

export const PAGES: Record<string, Page> = {
  pg_welcome: {
    id: 'pg_welcome',
    title: 'Welcome to Cobble',
    icon: '👋',
    blocks: [
      block({ type: 'heading', headingLevel: 1, text: 'Welcome to Cobble' }),
      block({
        type: 'paragraph',
        text: 'This is a demo workspace rendered entirely in the browser — every block below is editable, but nothing is written to disk yet (the storage/index crates land in M1).',
      }),
      block({
        type: 'paragraph',
        text: 'Try the basics: click any text to edit it, check off a to-do, collapse the toggle, or switch themes from the sidebar.',
      }),
      block({ type: 'todo', checked: false, text: 'Edit this text — click and type' }),
      block({ type: 'todo', checked: true, text: 'Switch the theme with the switcher in the sidebar' }),
      block({ type: 'todo', checked: false, text: 'Open the command palette with ⌘K / Ctrl+K' }),
      block({
        type: 'toggle',
        text: 'Why files, not just a database?',
        children: [
          block({
            type: 'paragraph',
            text: 'Plain JSON files are the source of truth; SQLite is a fully rebuildable derived index. If the index ever gets corrupted, it rebuilds from the files — nothing is ever only in the database.',
          }),
        ],
      }),
      block({ type: 'quote', text: 'Files are truth. SQLite is a cache.' }),
      block({
        type: 'code',
        language: 'ts',
        text: "// one block per line, one file per page\ntype Block = { id: Ulid; type: BlockType; attrs: Json; children: Block[] }",
      }),
      block({ type: 'divider' }),
      block({
        type: 'table',
        rows: [
          ['Milestone', 'Scope', 'Status'],
          ['M0', 'Scaffolding', 'done'],
          ['M1', 'Page tree + editor + storage', 'in progress'],
        ],
      }),
      block({ type: 'sub_page', linkedPageId: 'pg_roadmap' }),
      block({ type: 'paragraph', text: '' }),
    ],
  },

  pg_roadmap: {
    id: 'pg_roadmap',
    title: 'Product Roadmap',
    icon: '🗺️',
    blocks: [
      block({ type: 'heading', headingLevel: 1, text: 'Product Roadmap' }),
      block({ type: 'paragraph', text: 'High-level milestones, mirrored from TASKS.md.' }),
      block({
        type: 'toggle',
        text: 'M2 — Rich blocks + global calendar',
        children: [
          block({ type: 'todo', checked: false, text: 'Remaining block types (toggle, quote, code, image, table)' }),
          block({ type: 'todo', checked: false, text: 'Drag-to-reorder' }),
          block({ type: 'todo', checked: false, text: 'Slash-command menu' }),
          block({ type: 'todo', checked: false, text: 'Global CalendarGrid + daily notes' }),
        ],
      }),
      block({ type: 'divider' }),
      block({ type: 'sub_page', linkedPageId: 'pg_q1' }),
      block({ type: 'sub_page', linkedPageId: 'pg_q2' }),
    ],
  },

  pg_q1: {
    id: 'pg_q1',
    title: 'Q1 Goals',
    icon: '🎯',
    blocks: [
      block({ type: 'heading', headingLevel: 2, text: 'Q1 Goals' }),
      block({ type: 'todo', checked: true, text: 'Ship the page tree + block editor' }),
      block({ type: 'todo', checked: false, text: 'Ship the global calendar' }),
    ],
  },
  pg_q2: {
    id: 'pg_q2',
    title: 'Q2 Goals',
    icon: '🎯',
    blocks: [
      block({ type: 'heading', headingLevel: 2, text: 'Q2 Goals' }),
      block({ type: 'todo', checked: false, text: 'Ship database views (table/board/gallery)' }),
      block({ type: 'todo', checked: false, text: 'Ship the plugin API MVP' }),
    ],
  },

  pg_journal: {
    id: 'pg_journal',
    title: 'Journal',
    icon: '📓',
    blocks: [
      block({ type: 'heading', headingLevel: 1, text: 'Journal' }),
      block({
        type: 'paragraph',
        text: 'Daily notes live here. Open the Calendar and click a day to create one — it auto-files under this page.',
      }),
    ],
  },
  pg_daily_0830: {
    id: 'pg_daily_0830',
    title: 'Sun, Aug 30',
    icon: '📅',
    date: '2026-08-30',
    isDailyNote: true,
    blocks: [
      block({ type: 'heading', headingLevel: 2, text: 'Sun, Aug 30' }),
      block({ type: 'paragraph', text: 'Sketched the block schema for plugin-contributed blocks.' }),
    ],
  },
  pg_daily_0831: {
    id: 'pg_daily_0831',
    title: 'Mon, Aug 31',
    icon: '📅',
    date: '2026-08-31',
    isDailyNote: true,
    blocks: [
      block({ type: 'heading', headingLevel: 2, text: 'Mon, Aug 31' }),
      block({ type: 'todo', checked: true, text: 'Wire Tauri shell to the Vite dev server' }),
      block({ type: 'todo', checked: true, text: 'Confirm cargo check --workspace is clean' }),
    ],
  },
  pg_daily_0901: {
    id: 'pg_daily_0901',
    title: 'Tue, Sep 1',
    icon: '📅',
    date: '2026-09-01',
    isDailyNote: true,
    blocks: [
      block({ type: 'heading', headingLevel: 2, text: 'Tue, Sep 1' }),
      block({ type: 'paragraph', text: 'Put together a UI demo — sidebar, editor, calendar, themes, command palette.' }),
    ],
  },

  pg_reading: {
    id: 'pg_reading',
    title: 'Reading List',
    icon: '📚',
    blocks: [
      block({ type: 'heading', headingLevel: 1, text: 'Reading List' }),
      block({
        type: 'paragraph',
        text: 'A plain table for now — this becomes a real typed database (M3) with sort/filter/group and a board view.',
      }),
      block({
        type: 'table',
        rows: [
          ['Title', 'Status', 'Rating'],
          ['Designing Data-Intensive Applications', 'reading', '—'],
          ['A Philosophy of Software Design', 'done', '★★★★★'],
          ['The WASI Component Model spec', 'queued', '—'],
        ],
      }),
    ],
  },
}

export const CHILDREN: Record<string, string[]> = {
  root: ['pg_welcome', 'pg_roadmap', 'pg_journal', 'pg_reading'],
  pg_roadmap: ['pg_q1', 'pg_q2'],
  pg_journal: ['pg_daily_0830', 'pg_daily_0831', 'pg_daily_0901'],
}

export const nextId = (prefix: string) => id(prefix)

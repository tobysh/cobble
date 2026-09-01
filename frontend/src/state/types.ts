export type Theme = 'light' | 'dark' | 'night'

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'code'
  | 'divider'
  | 'table'
  | 'image'
  | 'sub_page'

export interface Block {
  id: string
  type: BlockType
  text?: string
  checked?: boolean
  headingLevel?: 1 | 2 | 3
  language?: string
  caption?: string
  rows?: string[][]
  children?: Block[]
  linkedPageId?: string
}

export interface Page {
  id: string
  title: string
  icon: string
  blocks: Block[]
  date?: string // ISO yyyy-mm-dd, powers the reserved `date` property / calendar
  isDailyNote?: boolean
}

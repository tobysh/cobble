import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from '@lexical/list'
import { $createHorizontalRuleNode, $isHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { $createHeadingNode, $isHeadingNode, $createQuoteNode, $isQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $createCodeNode, $isCodeNode } from '@lexical/code'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor, type LexicalNode, type NodeKey } from 'lexical'
import { newUlid } from '../state/ulid'
import type { Block, BlockId, BlockType } from '../state/types'
import {
  $createToggleContainerNode,
  $createToggleContentNode,
  $createToggleTitleNode,
  $isToggleContainerNode,
} from './nodes/ToggleNode'
import { $createImageBlockNode, $isImageBlockNode } from './nodes/ImageBlockNode'
import { $createTableBlockNode, $isTableBlockNode } from './nodes/TableBlockNode'
import { $createSubPageBlockNode, $isSubPageBlockNode } from './nodes/SubPageBlockNode'

// Converts between the page's persisted `Block[]` (== `cobble_core::Block`,
// see the comment on `Block` in `state/types.ts`) and Lexical's node tree.
// One top-level Lexical node is one `Block`, with two exceptions:
//  - consecutive `todo` blocks collapse into a single Lexical
//    `ListNode(listType: 'check')` with one `ListItemNode` per block —
//    that's exactly how Lexical's own checklist editing behaves (Enter
//    inside a check item adds a sibling item in the same list), so it
//    round-trips naturally instead of fighting the node model.
//  - a `toggle` block maps to a `ToggleContainerNode` wrapping a
//    `ToggleTitleNode` (the block's `content`) and a `ToggleContentNode`
//    (the block's `children`, itself built/read via the same
//    `buildNodes`/`lexicalNodesToBlocks` pair, recursively).
//
// `Block.id` (a ULID, forever-stable per CLAUDE.md) is preserved across a
// save/reload pair by keeping a `NodeKey -> BlockId` side map on the React
// side (`PageView`'s `nodeIdMap` ref) rather than trying to stash the id
// inside the Lexical node itself. New nodes (created by typing Enter, or via
// the slash menu) get a fresh `newUlid()` the first time they're serialized.

function textOf(block: Block): string {
  return (block.content ?? []).map((span) => span.text).join('')
}

function headingTag(block: Block): HeadingTagType {
  const raw = block.attrs?.level
  const level = typeof raw === 'number' ? Math.round(raw) : 1
  const clamped = Math.min(3, Math.max(1, level))
  return `h${clamped}` as HeadingTagType
}

function codeLanguage(block: Block): string | undefined {
  const raw = block.attrs?.language
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function tableRows(block: Block): string[][] {
  const raw = block.attrs?.rows
  if (
    Array.isArray(raw) &&
    raw.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))
  ) {
    return raw as string[][]
  }
  return [
    ['', ''],
    ['', ''],
  ]
}

/**
 * Builds the initial Lexical node tree for a page's blocks. Intended to be
 * used directly as `LexicalComposer`'s `initialConfig.editorState` (a
 * function is called by Lexical inside an `editor.update()`, with
 * `$`-prefixed functions already valid to call).
 */
export function populateEditorFromBlocks(blocks: Block[], idMap: Map<NodeKey, BlockId>) {
  return (_editor: LexicalEditor) => {
    const root = $getRoot()
    root.clear()
    for (const node of buildNodes(blocks, idMap)) {
      root.append(node)
    }
  }
}

function buildNodes(blocks: Block[], idMap: Map<NodeKey, BlockId>): LexicalNode[] {
  const nodes: LexicalNode[] = []
  let i = 0

  while (i < blocks.length) {
    const block = blocks[i]

    if (block.type === 'todo') {
      const list = $createListNode('check')
      while (i < blocks.length && blocks[i].type === 'todo') {
        const todo = blocks[i]
        const item = $createListItemNode(Boolean(todo.attrs?.checked))
        item.append($createTextNode(textOf(todo)))
        list.append(item)
        idMap.set(item.getKey(), todo.id)
        i++
      }
      nodes.push(list)
      continue
    }

    if (block.type === 'heading') {
      const heading = $createHeadingNode(headingTag(block))
      heading.append($createTextNode(textOf(block)))
      nodes.push(heading)
      idMap.set(heading.getKey(), block.id)
      i++
      continue
    }

    if (block.type === 'divider') {
      const hr = $createHorizontalRuleNode()
      nodes.push(hr)
      idMap.set(hr.getKey(), block.id)
      i++
      continue
    }

    if (block.type === 'quote') {
      const quote = $createQuoteNode()
      quote.append($createTextNode(textOf(block)))
      nodes.push(quote)
      idMap.set(quote.getKey(), block.id)
      i++
      continue
    }

    if (block.type === 'code') {
      const code = $createCodeNode(codeLanguage(block))
      code.append($createTextNode(textOf(block)))
      nodes.push(code)
      idMap.set(code.getKey(), block.id)
      i++
      continue
    }

    if (block.type === 'toggle') {
      const container = $createToggleContainerNode(true)
      const title = $createToggleTitleNode()
      title.append($createTextNode(textOf(block)))
      const content = $createToggleContentNode()
      for (const childNode of buildNodes(block.children ?? [], idMap)) {
        content.append(childNode)
      }
      if (content.getChildrenSize() === 0) content.append($createParagraphNode())
      container.append(title, content)
      nodes.push(container)
      idMap.set(container.getKey(), block.id)
      i++
      continue
    }

    if (block.type === 'image') {
      const src = typeof block.attrs?.src === 'string' ? block.attrs.src : ''
      const alt = typeof block.attrs?.alt === 'string' ? block.attrs.alt : ''
      const image = $createImageBlockNode(src, alt)
      nodes.push(image)
      idMap.set(image.getKey(), block.id)
      i++
      continue
    }

    if (block.type === 'table') {
      const table = $createTableBlockNode(tableRows(block))
      nodes.push(table)
      idMap.set(table.getKey(), block.id)
      i++
      continue
    }

    if (block.type === 'sub_page') {
      const pageId = typeof block.attrs?.page_id === 'string' ? block.attrs.page_id : ''
      const subPage = $createSubPageBlockNode(pageId)
      nodes.push(subPage)
      idMap.set(subPage.getKey(), block.id)
      i++
      continue
    }

    // `paragraph`, and any other/legacy block type (currently just
    // `plugin_block`, a separate in-flight task) falls back to a plain
    // paragraph carrying its flattened text — this editor only ever writes
    // back the types handled above, so anything else is a read-only
    // downgrade rather than data loss on disk (the file isn't touched until
    // this page's blocks are next saved).
    const paragraph = $createParagraphNode()
    paragraph.append($createTextNode(textOf(block)))
    nodes.push(paragraph)
    idMap.set(paragraph.getKey(), block.id)
    i++
  }

  if (nodes.length === 0) {
    nodes.push($createParagraphNode())
  }

  return nodes
}

function blockIdFor(nodeKey: NodeKey, idMap: Map<NodeKey, BlockId>): BlockId {
  let id = idMap.get(nodeKey)
  if (!id) {
    id = newUlid()
    idMap.set(nodeKey, id)
  }
  return id
}

function makeBlock(
  nodeKey: NodeKey,
  idMap: Map<NodeKey, BlockId>,
  type: BlockType,
  text: string,
  attrs?: Record<string, unknown>,
  children?: Block[],
): Block {
  return {
    id: blockIdFor(nodeKey, idMap),
    type,
    attrs,
    content: text ? [{ text }] : [],
    children: children && children.length > 0 ? children : undefined,
  }
}

/** Converts one "row" of top-level-ish Lexical nodes (the document root, or
 * a toggle's content region) into `Block[]`, recursing into toggle content. */
function lexicalNodesToBlocks(nodes: LexicalNode[], idMap: Map<NodeKey, BlockId>): Block[] {
  const blocks: Block[] = []

  for (const node of nodes) {
    if ($isHeadingNode(node)) {
      const level = Number(node.getTag().slice(1)) || 1
      blocks.push(makeBlock(node.getKey(), idMap, 'heading', node.getTextContent(), { level }))
      continue
    }

    if ($isHorizontalRuleNode(node)) {
      blocks.push(makeBlock(node.getKey(), idMap, 'divider', ''))
      continue
    }

    if ($isQuoteNode(node)) {
      blocks.push(makeBlock(node.getKey(), idMap, 'quote', node.getTextContent()))
      continue
    }

    if ($isCodeNode(node)) {
      const language = node.getLanguage()
      blocks.push(
        makeBlock(node.getKey(), idMap, 'code', node.getTextContent(), language ? { language } : undefined),
      )
      continue
    }

    if ($isListNode(node) && node.getListType() === 'check') {
      for (const item of node.getChildren()) {
        if (!$isListItemNode(item)) continue
        blocks.push(
          makeBlock(item.getKey(), idMap, 'todo', item.getTextContent(), {
            checked: Boolean(item.getChecked()),
          }),
        )
      }
      continue
    }

    if ($isToggleContainerNode(node)) {
      const title = node.getTitleNode()
      const content = node.getContentNode()
      const children = content ? lexicalNodesToBlocks(content.getChildren(), idMap) : []
      blocks.push(makeBlock(node.getKey(), idMap, 'toggle', title?.getTextContent() ?? '', undefined, children))
      continue
    }

    if ($isImageBlockNode(node)) {
      blocks.push(makeBlock(node.getKey(), idMap, 'image', '', { src: node.getSrc(), alt: node.getAlt() }))
      continue
    }

    if ($isTableBlockNode(node)) {
      blocks.push(makeBlock(node.getKey(), idMap, 'table', '', { rows: node.getRows() }))
      continue
    }

    if ($isSubPageBlockNode(node)) {
      blocks.push(makeBlock(node.getKey(), idMap, 'sub_page', '', { page_id: node.getPageId() }))
      continue
    }

    // Paragraph, and anything unrecognized (defensive — the node set this
    // editor registers doesn't produce anything else).
    blocks.push(makeBlock(node.getKey(), idMap, 'paragraph', node.getTextContent()))
  }

  return blocks
}

/** Reads the current editor state (call inside `editorState.read()`) back into `Block[]`. */
export function editorStateToBlocks(idMap: Map<NodeKey, BlockId>): Block[] {
  return lexicalNodesToBlocks($getRoot().getChildren(), idMap)
}

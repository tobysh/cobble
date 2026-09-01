import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from '@lexical/list'
import { $createHorizontalRuleNode, $isHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { $createHeadingNode, $isHeadingNode, type HeadingTagType } from '@lexical/rich-text'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor, type LexicalNode, type NodeKey } from 'lexical'
import { newUlid } from '../state/ulid'
import type { Block, BlockId, BlockType } from '../state/types'

// Converts between the page's persisted `Block[]` (== `cobble_core::Block`,
// see the comment on `Block` in `state/types.ts`) and Lexical's node tree.
// One top-level Lexical node is one `Block`, with one exception: consecutive
// `todo` blocks collapse into a single Lexical `ListNode(listType: 'check')`
// with one `ListItemNode` per block — that's exactly how Lexical's own
// checklist editing behaves (Enter inside a check item adds a sibling item
// in the same list), so it round-trips naturally instead of fighting the
// node model.
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

    // `paragraph`, and any other/legacy block type (M2's toggle/quote/code/
    // table/image/sub_page/plugin_block) falls back to a plain paragraph
    // carrying its flattened text — this editor only ever writes back
    // paragraph/heading/todo/divider, so anything else is a read-only
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
): Block {
  return {
    id: blockIdFor(nodeKey, idMap),
    type,
    attrs,
    content: text ? [{ text }] : [],
  }
}

/** Reads the current editor state (call inside `editorState.read()`) back into `Block[]`. */
export function editorStateToBlocks(idMap: Map<NodeKey, BlockId>): Block[] {
  const blocks: Block[] = []

  for (const node of $getRoot().getChildren()) {
    if ($isHeadingNode(node)) {
      const level = Number(node.getTag().slice(1)) || 1
      blocks.push(makeBlock(node.getKey(), idMap, 'heading', node.getTextContent(), { level }))
      continue
    }

    if ($isHorizontalRuleNode(node)) {
      blocks.push(makeBlock(node.getKey(), idMap, 'divider', ''))
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

    // Paragraph, and anything unrecognized (defensive — the node set this
    // editor registers doesn't produce anything else).
    blocks.push(makeBlock(node.getKey(), idMap, 'paragraph', node.getTextContent()))
  }

  return blocks
}

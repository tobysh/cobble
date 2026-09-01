import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { INSERT_CHECK_LIST_COMMAND } from '@lexical/list'
import { $setBlocksType } from '@lexical/selection'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $createCodeNode } from '@lexical/code'
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  type EditorState,
  type LexicalNode,
  type NodeKey,
} from 'lexical'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useWorkspace } from '../state/store'
import type { Block, BlockId, BlockType, PageId } from '../state/types'
import { editorTheme, EDITOR_NODES } from './nodes'
import { editorStateToBlocks, populateEditorFromBlocks } from './serialization'
import { $createImageBlockNode } from './nodes/ImageBlockNode'
import { $createSubPageBlockNode } from './nodes/SubPageBlockNode'
import { $createTableBlockNode } from './nodes/TableBlockNode'
import { $createToggleContainerNode, $createToggleContentNode, $createToggleTitleNode } from './nodes/ToggleNode'
import { SlashMenu } from './SlashMenu'
import './editor.css'

const SAVE_DEBOUNCE_MS = 500

/** The editable body of a page: one Lexical instance per page (keyed by `pageId` in `PageView`). */
function EditorBody({
  pageId,
  idMap,
}: {
  pageId: PageId
  idMap: Map<NodeKey, BlockId>
}) {
  const [editor] = useLexicalComposerContext()
  const saveBlocks = useWorkspace((s) => s.saveBlocks)
  const createSubPage = useWorkspace((s) => s.createSubPage)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null)
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null)

  // Tracks whether the selection sits inside an otherwise-empty paragraph
  // whose text starts with '/' — mirrors the old per-block `EditableText`'s
  // `onSlashChange`, just driven off Lexical's selection/content instead of
  // a single contentEditable's onInput.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let query: string | null = null
      let topLevelKey: NodeKey | null = null

      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
        const anchorNode = selection.anchor.getNode()
        const topLevel = anchorNode.getKey() === 'root' ? null : anchorNode.getTopLevelElement()
        if (topLevel && $isParagraphNode(topLevel)) {
          const text = topLevel.getTextContent()
          if (text.startsWith('/')) {
            query = text.slice(1)
            topLevelKey = topLevel.getKey()
          }
        }
      })

      setSlashQuery(query)

      if (query !== null && topLevelKey) {
        const el = editor.getElementByKey(topLevelKey)
        const container = containerRef.current
        if (el && container) {
          const elRect = el.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          setSlashPos({ top: elRect.bottom - containerRect.top, left: elRect.left - containerRect.left })
        }
      }
    })
  }, [editor])

  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (slashQuery === null) return false
        setDismissedQuery(slashQuery)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, slashQuery])

  const menuOpen = slashQuery !== null && slashQuery !== dismissedQuery

  const closeSlashMenu = useCallback(() => {
    if (slashQuery !== null) setDismissedQuery(slashQuery)
  }, [slashQuery])

  // Converts the current (slash-triggered) paragraph into the chosen block
  // type via Lexical's own node/command APIs — `$setBlocksType` for
  // heading/quote/code (an in-place element swap, since those are all
  // single-`ElementNode` types like paragraph itself),
  // `INSERT_CHECK_LIST_COMMAND` / `INSERT_HORIZONTAL_RULE_COMMAND` for
  // todo/divider (dispatched, since those commands do their own
  // `editor.update()` internally and shouldn't be nested inside one of
  // ours), and a manual `node.replace()` for toggle/image/table (compound
  // or decorator nodes `$setBlocksType` can't produce). Sub-page is async
  // (it creates a new page first) so it's handled after this update closes.
  const applyBlockType = useCallback(
    (type: BlockType) => {
      let topLevelKey: NodeKey | null = null

      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const topLevel = selection.anchor.getNode().getTopLevelElementOrThrow()
        if (!$isParagraphNode(topLevel)) return
        topLevelKey = topLevel.getKey()

        // Strip the leading "/query" text the user typed to trigger the menu.
        topLevel.select(0, topLevel.getChildrenSize())
        const clearing = $getSelection()
        if ($isRangeSelection(clearing)) clearing.insertText('')

        if (type === 'heading') {
          const afterClear = $getSelection()
          if ($isRangeSelection(afterClear)) {
            $setBlocksType(afterClear, () => $createHeadingNode('h1'))
          }
        } else if (type === 'quote') {
          const afterClear = $getSelection()
          if ($isRangeSelection(afterClear)) {
            $setBlocksType(afterClear, () => $createQuoteNode())
          }
        } else if (type === 'code') {
          const afterClear = $getSelection()
          if ($isRangeSelection(afterClear)) {
            $setBlocksType(afterClear, () => $createCodeNode())
          }
        } else if (type === 'toggle') {
          const current = $getNodeByKey(topLevelKey)
          if (current) {
            const container = $createToggleContainerNode(true)
            const title = $createToggleTitleNode()
            const content = $createToggleContentNode()
            content.append($createParagraphNode())
            container.append(title, content)
            current.replace(container)
            title.selectStart()
          }
        } else if (type === 'image') {
          const current = $getNodeByKey(topLevelKey)
          if (current) current.replace($createImageBlockNode())
        } else if (type === 'table') {
          const current = $getNodeByKey(topLevelKey)
          if (current) current.replace($createTableBlockNode())
        }
      })

      if (type === 'todo') {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
      } else if (type === 'divider') {
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
      } else if (type === 'sub_page') {
        void (async () => {
          const newPageId = await createSubPage(pageId, 'Untitled')
          editor.update(() => {
            const current: LexicalNode | null = topLevelKey ? $getNodeByKey(topLevelKey) : null
            if (current) current.replace($createSubPageBlockNode(newPageId))
          })
        })()
      }

      setSlashQuery(null)
      setDismissedQuery(null)
    },
    [editor, createSubPage, pageId],
  )

  // --- Drag-to-reorder ----------------------------------------------------
  // One drag handle per top-level Lexical node (== one persisted `Block`,
  // except a run of `todo` blocks which collapses into a single check-list
  // node — see serialization.ts — so the whole list drags as a unit).
  // There's no per-block wrapper element to attach a handle to (this editor
  // is one Lexical document, not a list of block components), so handles
  // are positioned from live DOM rects the same way the slash menu is.
  //
  // Reordering moves the actual `LexicalNode` — `ElementNode.append()` on a
  // node that's already attached relocates it instead of duplicating it —
  // so NodeKeys, and therefore `idMap`'s NodeKey -> BlockId mapping, never
  // change. Only position changes, per "block IDs are forever" (CLAUDE.md).
  // The resulting editor-state change flows through the same debounced
  // `OnChangePlugin` -> `saveBlocks` -> `update_page_blocks` path as any
  // other edit, so it persists through the real save path, not local state.
  const [blockRects, setBlockRects] = useState<{ key: NodeKey; top: number; height: number }[]>([])
  const [draggingKey, setDraggingKey] = useState<NodeKey | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const recomputeBlockRects = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const rects: { key: NodeKey; top: number; height: number }[] = []
    editor.getEditorState().read(() => {
      for (const node of $getRoot().getChildren()) {
        const el = editor.getElementByKey(node.getKey())
        if (!el) continue
        const elRect = el.getBoundingClientRect()
        rects.push({ key: node.getKey(), top: elRect.top - containerRect.top, height: elRect.height })
      }
    })
    setBlockRects(rects)
  }, [editor])

  useEffect(() => {
    recomputeBlockRects()
    const unregister = editor.registerUpdateListener(() => recomputeBlockRects())
    window.addEventListener('resize', recomputeBlockRects)
    return () => {
      unregister()
      window.removeEventListener('resize', recomputeBlockRects)
    }
  }, [editor, recomputeBlockRects])

  const handleDragStart = useCallback(
    (key: NodeKey) => (e: DragEvent) => {
      setDraggingKey(key)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', key)
    },
    [],
  )

  const handleDragEnd = useCallback(() => {
    setDraggingKey(null)
    setDropIndex(null)
  }, [])

  const handleContainerDragOver = useCallback(
    (e: DragEvent) => {
      if (!draggingKey) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const container = containerRef.current
      if (!container) return
      const y = e.clientY - container.getBoundingClientRect().top
      let idx = blockRects.length
      for (let i = 0; i < blockRects.length; i++) {
        if (y < blockRects[i].top + blockRects[i].height / 2) {
          idx = i
          break
        }
      }
      setDropIndex(idx)
    },
    [draggingKey, blockRects],
  )

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const sourceKey = draggingKey
      const targetIndex = dropIndex
      setDraggingKey(null)
      setDropIndex(null)
      if (!sourceKey || targetIndex === null) return

      editor.update(() => {
        const root = $getRoot()
        const originalKeys = root.getChildren().map((n) => n.getKey())
        if (!originalKeys.includes(sourceKey)) return

        const withoutSource = originalKeys.filter((k) => k !== sourceKey)
        const targetKey = targetIndex < originalKeys.length ? originalKeys[targetIndex] : null
        const insertAt =
          targetKey && targetKey !== sourceKey ? withoutSource.indexOf(targetKey) : withoutSource.length
        const newOrder = [...withoutSource.slice(0, insertAt), sourceKey, ...withoutSource.slice(insertAt)]

        if (newOrder.join('|') === originalKeys.join('|')) return

        // Re-appending each node in the desired order moves it to the end
        // of `root`'s children (it's already attached, so this relocates
        // rather than clones it), leaving the tree in `newOrder` once done.
        for (const key of newOrder) {
          const node = $getNodeByKey(key)
          if (node) root.append(node)
        }
      })
    },
    [editor, draggingKey, dropIndex],
  )

  const dropIndicatorTop =
    dropIndex === null
      ? null
      : dropIndex < blockRects.length
        ? blockRects[dropIndex].top - 3
        : (blockRects[blockRects.length - 1]?.top ?? 0) + (blockRects[blockRects.length - 1]?.height ?? 0) + 3

  const flushSave = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        void saveBlocks(pageId, editorStateToBlocks(idMap))
      })
    },
    [idMap, pageId, saveBlocks],
  )

  const handleChange = useCallback(
    (editorState: EditorState) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => flushSave(editorState), SAVE_DEBOUNCE_MS)
    },
    [flushSave],
  )

  // Flush a pending debounced save immediately on unmount (switching pages)
  // rather than dropping up to `SAVE_DEBOUNCE_MS` of edits.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        flushSave(editor.getEditorState())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="page-blocks"
      ref={containerRef}
      onClick={(e) => {
        if (e.target === containerRef.current) editor.focus()
      }}
      onDragOver={handleContainerDragOver}
      onDrop={handleDrop}
    >
      <div className="block-gutter">
        {blockRects.map((rect) => (
          <div
            key={rect.key}
            className={
              draggingKey === rect.key ? 'block-drag-handle block-drag-handle--dragging' : 'block-drag-handle'
            }
            style={{ top: rect.top + rect.height / 2 - 9 }}
            draggable
            onDragStart={handleDragStart(rect.key)}
            onDragEnd={handleDragEnd}
            title="Drag to reorder"
          >
            <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
              <circle cx="3" cy="3" r="1.3" />
              <circle cx="7" cy="3" r="1.3" />
              <circle cx="3" cy="8" r="1.3" />
              <circle cx="7" cy="8" r="1.3" />
              <circle cx="3" cy="13" r="1.3" />
              <circle cx="7" cy="13" r="1.3" />
            </svg>
          </div>
        ))}
      </div>
      {dropIndicatorTop !== null && <div className="block-drop-indicator" style={{ top: dropIndicatorTop }} />}
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="editor-content"
            aria-placeholder="Type '/' for commands"
            placeholder={<div className="editor-placeholder">Type &lsquo;/&rsquo; for commands</div>}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <HorizontalRulePlugin />
      <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
      {slashPos && (
        <div style={{ position: 'absolute', top: slashPos.top, left: slashPos.left }}>
          <SlashMenu open={menuOpen} query={slashQuery ?? ''} onSelect={applyBlockType} onClose={closeSlashMenu} />
        </div>
      )}
    </div>
  )
}

export function PageView({ pageId }: { pageId: PageId }) {
  const page = useWorkspace((s) => s.pages[pageId])
  const updatePageTitle = useWorkspace((s) => s.updatePageTitle)
  const idMapRef = useRef<Map<NodeKey, BlockId>>(new Map())

  const initialBlocks = useMemo<Block[]>(() => page?.blocks ?? [], [page])

  const initialConfig = useMemo(
    () => ({
      namespace: `cobble-page-${pageId}`,
      theme: editorTheme,
      nodes: EDITOR_NODES,
      onError: (error: Error) => {
        console.error('[lexical]', error)
      },
      editorState: populateEditorFromBlocks(initialBlocks, idMapRef.current),
    }),
    // Intentionally built once per mount (`PageView` is remounted by a
    // `key={pageId}` one level up in App.tsx whenever the open page
    // changes) — LexicalComposer only ever consumes `initialConfig` on its
    // first render, so re-deriving it from `page` on every keystroke would
    // be pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageId],
  )

  if (!page) {
    return <div className="page-view page-view--missing">Page not found.</div>
  }

  return (
    <div className="page-view">
      <div className="page-header">
        <div className="page-icon">{page.icon}</div>
        <input
          className="page-title"
          value={page.title}
          placeholder="Untitled"
          onChange={(e) => updatePageTitle(pageId, e.target.value)}
        />
      </div>

      <LexicalComposer initialConfig={initialConfig}>
        <EditorBody pageId={pageId} idMap={idMapRef.current} />
      </LexicalComposer>
    </div>
  )
}

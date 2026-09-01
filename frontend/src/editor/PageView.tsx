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
import { $createHeadingNode } from '@lexical/rich-text'
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  type EditorState,
  type NodeKey,
} from 'lexical'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../state/store'
import type { Block, BlockId, BlockType, PageId } from '../state/types'
import { editorTheme, EDITOR_NODES } from './nodes'
import { editorStateToBlocks, populateEditorFromBlocks } from './serialization'
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
  // type via Lexical's own node/command APIs — `$setBlocksType` for heading
  // (an in-place element swap), `INSERT_CHECK_LIST_COMMAND` /
  // `INSERT_HORIZONTAL_RULE_COMMAND` for todo/divider (dispatched, since
  // those commands do their own `editor.update()` internally and shouldn't
  // be nested inside one of ours).
  const applyBlockType = useCallback(
    (type: BlockType) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const topLevel = selection.anchor.getNode().getTopLevelElementOrThrow()
        if (!$isParagraphNode(topLevel)) return

        // Strip the leading "/query" text the user typed to trigger the menu.
        topLevel.select(0, topLevel.getChildrenSize())
        const clearing = $getSelection()
        if ($isRangeSelection(clearing)) clearing.insertText('')

        if (type === 'heading') {
          const afterClear = $getSelection()
          if ($isRangeSelection(afterClear)) {
            $setBlocksType(afterClear, () => $createHeadingNode('h1'))
          }
        }
      })

      if (type === 'todo') {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
      } else if (type === 'divider') {
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
      }

      setSlashQuery(null)
      setDismissedQuery(null)
    },
    [editor],
  )

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
    >
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

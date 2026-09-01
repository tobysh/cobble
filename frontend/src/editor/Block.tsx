import { ChevronRight, FileText, GripVertical, ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { useWorkspace } from '../state/store'
import type { Block as BlockData } from '../state/types'
import { EditableText } from './EditableText'
import { SlashMenu } from './SlashMenu'
import './editor.css'

export function Block({ pageId, block, path }: { pageId: string; block: BlockData; path: number[] }) {
  const toggleTodo = useWorkspace((s) => s.toggleTodo)
  const updateBlockText = useWorkspace((s) => s.updateBlockText)
  const setBlockType = useWorkspace((s) => s.setBlockType)
  const updateTableCell = useWorkspace((s) => s.updateTableCell)
  const expandedBlocks = useWorkspace((s) => s.expandedBlocks)
  const toggleBlockExpanded = useWorkspace((s) => s.toggleBlockExpanded)
  const openPage = useWorkspace((s) => s.openPage)
  const pages = useWorkspace((s) => s.pages)

  const [slashQuery, setSlashQuery] = useState<string | null>(null)

  const setText = (text: string) => updateBlockText(pageId, path, text)

  const slashCapable = block.type === 'paragraph'
  const editable = (
    <EditableText
      value={block.text ?? ''}
      onChange={setText}
      placeholder="Type '/' for commands"
      className="block-text"
      onSlashChange={slashCapable ? setSlashQuery : undefined}
    />
  )

  const wrap = (content: React.ReactNode, extraClass = '') => (
    <div className={`block-row ${extraClass}`}>
      <span className="block-grip">
        <GripVertical size={13} />
      </span>
      <div className="block-content-wrap">
        {content}
        <SlashMenu
          open={slashQuery !== null}
          query={slashQuery ?? ''}
          onClose={() => setSlashQuery(null)}
          onSelect={(type) => {
            setBlockType(pageId, path, type)
            setSlashQuery(null)
          }}
        />
      </div>
    </div>
  )

  switch (block.type) {
    case 'heading':
      return wrap(
        <EditableText
          value={block.text ?? ''}
          onChange={setText}
          className={`block-heading block-heading--${block.headingLevel ?? 1}`}
        />,
      )

    case 'paragraph':
      return wrap(editable)

    case 'todo':
      return wrap(
        <div className="block-todo">
          <input
            type="checkbox"
            checked={!!block.checked}
            onChange={() => toggleTodo(pageId, path)}
          />
          <EditableText
            value={block.text ?? ''}
            onChange={setText}
            className={`block-text${block.checked ? ' block-text--done' : ''}`}
          />
        </div>,
      )

    case 'toggle': {
      const open = expandedBlocks.has(block.id)
      return (
        <div className="block-toggle-wrapper">
          {wrap(
            <div className="block-toggle-head">
              <button type="button" className="toggle-caret" onClick={() => toggleBlockExpanded(block.id)}>
                <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 140ms ease' }} />
              </button>
              <EditableText value={block.text ?? ''} onChange={setText} className="block-text" />
            </div>,
          )}
          {open && (
            <div className="block-toggle-children">
              {(block.children ?? []).map((child, i) => (
                <Block key={child.id} pageId={pageId} block={child} path={[...path, i]} />
              ))}
            </div>
          )}
        </div>
      )
    }

    case 'quote':
      return wrap(<EditableText value={block.text ?? ''} onChange={setText} className="block-quote" />)

    case 'code':
      return wrap(
        <div className="block-code">
          <div className="block-code-lang">{block.language ?? 'text'}</div>
          <EditableText value={block.text ?? ''} onChange={setText} className="block-code-text" />
        </div>,
      )

    case 'divider':
      return wrap(<hr className="block-divider" />)

    case 'table':
      return wrap(
        <table className="block-table">
          <tbody>
            {(block.rows ?? []).map((row, r) => (
              <tr key={r} className={r === 0 ? 'block-table-header' : undefined}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <EditableText
                      as="span"
                      value={cell}
                      onChange={(text) => updateTableCell(pageId, path, r, c, text)}
                      className="block-table-cell"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )

    case 'image':
      return wrap(
        <div className="block-image">
          <div className="block-image-placeholder">
            <ImageIcon size={22} />
            <span>No image — this is a placeholder block</span>
          </div>
          <EditableText
            value={block.caption ?? ''}
            onChange={(text) => updateBlockText(pageId, path, text)}
            placeholder="Add a caption"
            className="block-image-caption"
          />
        </div>,
      )

    case 'sub_page': {
      const linked = block.linkedPageId ? pages[block.linkedPageId] : undefined
      if (!linked) return null
      return wrap(
        <button type="button" className="block-subpage" onClick={() => openPage(linked.id)}>
          <FileText size={15} />
          <span className="block-subpage-icon">{linked.icon}</span>
          <span>{linked.title}</span>
        </button>,
      )
    }

    default:
      return null
  }
}

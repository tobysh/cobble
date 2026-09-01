import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../state/api'
import { useWorkspace } from '../state/store'
import type { PageId } from '../state/types'
import './backlinks-panel.css'

/**
 * Shown at the bottom of a page, below its content — pages that reference
 * this one via a relation property or a sub-page block, backed by
 * `cobble_index::Index::backlinks` through the `get_backlinks` Tauri
 * command. Only bare `PageId`s cross the IPC boundary; title/icon are
 * resolved from the already-loaded `pages` map (see `state/store.ts`'s
 * `loadWorkspace`), same as the command-palette search results.
 */
export function BacklinksPanel({ pageId }: { pageId: PageId }) {
  const pages = useWorkspace((s) => s.pages)
  const openPage = useWorkspace((s) => s.openPage)
  const [backlinkIds, setBacklinkIds] = useState<PageId[]>([])

  useEffect(() => {
    let cancelled = false
    void api.getBacklinks(pageId).then((ids) => {
      if (!cancelled) setBacklinkIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [pageId])

  if (backlinkIds.length === 0) return null

  return (
    <div className="backlinks-panel">
      <div className="backlinks-heading">
        <Link2 size={13} />
        <span>{backlinkIds.length} linked mention{backlinkIds.length === 1 ? '' : 's'}</span>
      </div>
      <div className="backlinks-list">
        {backlinkIds.map((id) => {
          const page = pages[id]
          return (
            <button
              type="button"
              key={id}
              className="backlink-item"
              onClick={() => openPage(id)}
            >
              <span className="backlink-icon">{page?.icon ?? '📄'}</span>
              <span className="backlink-title">{page?.title || 'Untitled'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

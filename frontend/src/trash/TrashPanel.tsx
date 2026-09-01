import { motion } from 'framer-motion'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { useWorkspace } from '../state/store'
import { hoverLift, hoverTransition, listItemVariants, tapShrink } from '../theme/motion'
import './trash.css'

/**
 * Lists pages sitting in `.cobble/trash/` (soft-deleted by `Sidebar`'s
 * per-page delete action) and lets the user restore one — the inverse of
 * `delete_page`, backed by `Workspace::restore_page` via the `restore_page`
 * Tauri command. Restoring moves the file back into `pages/` on disk; it's
 * never just an index/UI-only flag flip (see "Files are truth" in
 * `CLAUDE.md`).
 */
export function TrashPanel() {
  const trash = useWorkspace((s) => s.trash)
  const loadTrash = useWorkspace((s) => s.loadTrash)
  const restoreFromTrash = useWorkspace((s) => s.restoreFromTrash)

  useEffect(() => {
    void loadTrash()
    // Refresh once on mount — `openTrash` in the store already triggers a
    // load when the nav item is clicked, but this covers a direct remount
    // (e.g. hot reload) without needing that action's caller to know.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="trash-view">
      <div className="trash-header">
        <Trash2 size={20} />
        <h1>Trash</h1>
      </div>

      {trash.length === 0 ? (
        <div className="trash-empty">No trashed pages.</div>
      ) : (
        <div className="trash-list">
          {trash.map((page, i) => (
            <motion.div
              key={page.id}
              className="trash-item"
              custom={i}
              variants={listItemVariants}
              initial="hidden"
              animate="visible"
            >
              <span className="trash-item-icon">{page.icon}</span>
              <span className="trash-item-title">{page.title || 'Untitled'}</span>
              <motion.button
                type="button"
                className="trash-restore"
                onClick={() => void restoreFromTrash(page.id)}
                whileHover={hoverLift}
                whileTap={tapShrink}
                transition={hoverTransition}
              >
                <RotateCcw size={13} />
                <span>Restore</span>
              </motion.button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

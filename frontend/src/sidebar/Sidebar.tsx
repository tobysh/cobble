import { motion } from 'framer-motion'
import { Calendar, ChevronRight, Moon, Plus, Search, Sun, SunMoon, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { hoverLift, hoverTransition, tapShrink } from '../theme/motion'
import { useWorkspace } from '../state/store'
import type { Theme } from '../state/types'
import './sidebar.css'

const THEME_OPTIONS: { key: Theme; label: string; icon: typeof Sun }[] = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'night', label: 'Night', icon: SunMoon },
]

function PageTreeItem({ pageId, depth }: { pageId: string; depth: number }) {
  const page = useWorkspace((s) => s.pages[pageId])
  const childIds = useWorkspace((s) => s.children[pageId]) ?? []
  const expanded = useWorkspace((s) => s.expandedTree.has(pageId))
  const isActive = useWorkspace((s) => s.view.kind === 'page' && s.view.pageId === pageId)
  const toggleExpanded = useWorkspace((s) => s.toggleTreeExpanded)
  const openPage = useWorkspace((s) => s.openPage)
  const deletePage = useWorkspace((s) => s.deletePage)

  if (!page) return null
  const hasChildren = childIds.length > 0

  return (
    <div className="tree-node">
      <motion.button
        type="button"
        className={`tree-row${isActive ? ' tree-row--active' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={() => openPage(pageId)}
        whileHover={hoverLift}
        whileTap={tapShrink}
        transition={hoverTransition}
      >
        <span
          className={`tree-caret${hasChildren ? '' : ' tree-caret--hidden'}`}
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(pageId)
          }}
        >
          <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 140ms ease' }} />
        </span>
        <span className="tree-icon">{page.icon}</span>
        <span className="tree-title">{page.title}</span>
        <span
          className="tree-delete"
          title="Move to trash"
          onClick={(e) => {
            e.stopPropagation()
            void deletePage(pageId)
          }}
        >
          <Trash2 size={12} />
        </span>
      </motion.button>
      {hasChildren && expanded && (
        <div className="tree-children">
          {childIds.map((id) => (
            <PageTreeItem key={id} pageId={id} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const rootIds = useWorkspace((s) => s.children.root) ?? [] // 'root' sentinel — see `childKey()` in state/store.ts
  const theme = useWorkspace((s) => s.theme)
  const setTheme = useWorkspace((s) => s.setTheme)
  const openCalendar = useWorkspace((s) => s.openCalendar)
  const openTrash = useWorkspace((s) => s.openTrash)
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen)
  const createPage = useWorkspace((s) => s.createPage)
  const isCalendarActive = useWorkspace((s) => s.view.kind === 'calendar')
  const isTrashActive = useWorkspace((s) => s.view.kind === 'trash')
  const [newPageHover, setNewPageHover] = useState(false)

  return (
    <aside className="sidebar">
      <div className="sidebar-workspace">
        <span className="sidebar-workspace-icon">◆</span>
        <span className="sidebar-workspace-name">Cobble</span>
      </div>

      <motion.button
        type="button"
        className="sidebar-search"
        onClick={() => setPaletteOpen(true)}
        whileHover={hoverLift}
        whileTap={tapShrink}
        transition={hoverTransition}
      >
        <Search size={14} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </motion.button>

      <motion.button
        type="button"
        className={`sidebar-nav-item${isCalendarActive ? ' sidebar-nav-item--active' : ''}`}
        onClick={openCalendar}
        whileHover={hoverLift}
        whileTap={tapShrink}
        transition={hoverTransition}
      >
        <Calendar size={15} />
        <span>Calendar</span>
      </motion.button>

      <motion.button
        type="button"
        className={`sidebar-nav-item${isTrashActive ? ' sidebar-nav-item--active' : ''}`}
        onClick={openTrash}
        whileHover={hoverLift}
        whileTap={tapShrink}
        transition={hoverTransition}
      >
        <Trash2 size={15} />
        <span>Trash</span>
      </motion.button>

      <div className="sidebar-section-label">Workspace</div>
      <nav className="tree-scroll">
        {rootIds.map((id) => (
          <PageTreeItem key={id} pageId={id} depth={0} />
        ))}
        <button
          type="button"
          className="tree-row tree-row--new"
          onMouseEnter={() => setNewPageHover(true)}
          onMouseLeave={() => setNewPageHover(false)}
          onClick={() => void createPage(null, 'Untitled')}
        >
          <span className="tree-caret tree-caret--hidden" />
          <Plus size={14} style={{ opacity: newPageHover ? 1 : 0.6 }} />
          <span className="tree-title tree-title--muted">New page</span>
        </button>
      </nav>

      <div className="sidebar-theme-switcher">
        {THEME_OPTIONS.map(({ key, label, icon: Icon }) => (
          <motion.button
            key={key}
            type="button"
            className={`theme-pill${theme === key ? ' theme-pill--active' : ''}`}
            onClick={() => setTheme(key)}
            whileHover={hoverLift}
            whileTap={tapShrink}
            transition={hoverTransition}
            title={label}
          >
            <Icon size={13} />
            <span>{label}</span>
          </motion.button>
        ))}
      </div>
    </aside>
  )
}

import { AnimatePresence, motion } from 'framer-motion'
import { Calendar, FileText, Moon, Sun, SunMoon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useWorkspace } from '../state/store'
import { dropdownVariants, listItemVariants, overlayVariants } from '../theme/motion'
import type { Page, Theme } from '../state/types'
import './command-palette.css'

interface Item {
  key: string
  label: string
  sublabel?: string
  icon: typeof FileText
  run: () => void
}

function buildItems(
  pages: Record<string, Page>,
  openPage: (id: string) => void,
  openCalendar: () => void,
  setTheme: (t: Theme) => void,
): Item[] {
  const pageItems: Item[] = Object.values(pages).map((p) => ({
    key: `page-${p.id}`,
    label: p.title || 'Untitled',
    sublabel: p.icon,
    icon: FileText,
    run: () => openPage(p.id),
  }))
  const themeItems: { theme: Theme; label: string; icon: typeof Sun }[] = [
    { theme: 'light', label: 'Switch to Light theme', icon: Sun },
    { theme: 'dark', label: 'Switch to Dark theme', icon: Moon },
    { theme: 'night', label: 'Switch to Night theme', icon: SunMoon },
  ]
  const actionItems: Item[] = [
    { key: 'go-calendar', label: 'Go to Calendar', icon: Calendar, run: openCalendar },
    ...themeItems.map(({ theme, label, icon }) => ({
      key: `theme-${theme}`,
      label,
      icon,
      run: () => setTheme(theme),
    })),
  ]
  return [...actionItems, ...pageItems]
}

// Mounted only while the palette is open, so its query/selection state
// starts fresh every time — no reset-on-open effect needed.
function PaletteContent({ onClose }: { onClose: () => void }) {
  const pages = useWorkspace((s) => s.pages)
  const openPage = useWorkspace((s) => s.openPage)
  const openCalendar = useWorkspace((s) => s.openCalendar)
  const setTheme = useWorkspace((s) => s.setTheme)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const items = useMemo(
    () => buildItems(pages, openPage, openCalendar, setTheme),
    [pages, openPage, openCalendar, setTheme],
  )
  const filtered = useMemo(
    () => items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())),
    [items, query],
  )

  const choose = (item: Item) => {
    item.run()
    onClose()
  }

  return (
    <motion.div
      className="palette-panel"
      variants={dropdownVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        className="palette-input"
        placeholder="Search pages, switch theme, jump to calendar…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && filtered[activeIndex]) {
            choose(filtered[activeIndex])
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      />
      <div className="palette-list">
        {filtered.length === 0 && <div className="palette-empty">No results</div>}
        {filtered.map((item, i) => {
          const Icon = item.icon
          return (
            <motion.button
              key={item.key}
              type="button"
              className={`palette-item${i === activeIndex ? ' palette-item--active' : ''}`}
              custom={i}
              variants={listItemVariants}
              initial="hidden"
              animate="visible"
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(item)}
            >
              <span className="palette-item-icon">
                <Icon size={15} />
              </span>
              <span className="palette-item-label">{item.label}</span>
              {item.sublabel && <span className="palette-item-sub">{item.sublabel}</span>}
            </motion.button>
          )
        })}
      </div>
    </motion.div>
  )
}

export function CommandPalette() {
  const open = useWorkspace((s) => s.paletteOpen)
  const setOpen = useWorkspace((s) => s.setPaletteOpen)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette-overlay"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onMouseDown={() => setOpen(false)}
        >
          <PaletteContent onClose={() => setOpen(false)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

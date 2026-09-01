import { AnimatePresence, motion } from 'framer-motion'
import { Calendar, FileText, Moon, Search, Sun, SunMoon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../state/api'
import { useWorkspace } from '../state/store'
import { dropdownVariants, listItemVariants, overlayVariants } from '../theme/motion'
import type { SearchHit } from '../state/api'
import type { Page, PageId, Theme } from '../state/types'
import './command-palette.css'

const SEARCH_DEBOUNCE_MS = 150

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

/**
 * Turns backend `search_pages` hits (block-level FTS5 matches, see
 * `cobble_index::Index::search_blocks`) into palette items — one per
 * matching block, showing which page it's in and a text snippet, so a hit
 * against a page's *content* (not just its title, which `buildItems` above
 * already covers client-side) is reachable from the same list. Hits whose
 * page already has a title-match item above are skipped to avoid showing the
 * same page twice for one query.
 */
function buildSearchHitItems(
  hits: SearchHit[],
  pages: Record<string, Page>,
  alreadyShownPageIds: Set<PageId>,
  openPage: (id: string) => void,
): Item[] {
  return hits
    .filter((hit) => !alreadyShownPageIds.has(hit.pageId))
    .map((hit) => {
      const page = pages[hit.pageId]
      return {
        key: `hit-${hit.blockId}`,
        label: page?.title || 'Untitled',
        sublabel: hit.text.length > 60 ? `${hit.text.slice(0, 60)}…` : hit.text,
        icon: Search,
        run: () => openPage(hit.pageId),
      }
    })
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
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])

  const items = useMemo(
    () => buildItems(pages, openPage, openCalendar, setTheme),
    [pages, openPage, openCalendar, setTheme],
  )
  const filtered = useMemo(
    () => items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())),
    [items, query],
  )

  // Debounced full-text search against `cobble-index`'s FTS5 table (see
  // `search_pages` in `state/api.ts`) — this is what makes search reach into
  // block *content*, not just page titles, which `filtered` above already
  // handles entirely client-side.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSearchHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void api.searchPages(trimmed).then((hits) => {
        if (!cancelled) setSearchHits(hits)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const hitItems = useMemo(() => {
    const shownPageIds = new Set(
      filtered.filter((i) => i.key.startsWith('page-')).map((i) => i.key.slice('page-'.length)),
    )
    return buildSearchHitItems(searchHits, pages, shownPageIds, openPage)
  }, [searchHits, pages, filtered, openPage])

  const combined = useMemo(() => [...filtered, ...hitItems], [filtered, hitItems])

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
            setActiveIndex((i) => Math.min(i + 1, combined.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && combined[activeIndex]) {
            choose(combined[activeIndex])
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      />
      <div className="palette-list">
        {combined.length === 0 && <div className="palette-empty">No results</div>}
        {combined.map((item, i) => {
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

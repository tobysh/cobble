import { useEffect } from 'react'
import { CalendarView } from './calendar/CalendarView'
import { CommandPalette } from './command-palette/CommandPalette'
import { PageView } from './editor/PageView'
import { Sidebar } from './sidebar/Sidebar'
import { useWorkspace } from './state/store'
import { TrashPanel } from './trash/TrashPanel'
import './theme/tokens.css'
import './App.css'

function MainView() {
  const view = useWorkspace((s) => s.view)
  const createPage = useWorkspace((s) => s.createPage)

  switch (view.kind) {
    case 'loading':
      return <div className="app-status">Loading workspace…</div>
    case 'empty':
      return (
        <div className="app-status">
          <p>No pages yet.</p>
          <button type="button" className="app-status-action" onClick={() => void createPage(null, 'Untitled')}>
            Create your first page
          </button>
        </div>
      )
    case 'calendar':
      return <CalendarView />
    case 'trash':
      return <TrashPanel />
    case 'page':
      // Keyed by pageId so switching pages remounts the Lexical editor with
      // a fresh `initialConfig` instead of trying to swap its content in
      // place (see the comment on `initialConfig` in `PageView.tsx`).
      return <PageView key={view.pageId} pageId={view.pageId} />
  }
}

function App() {
  const theme = useWorkspace((s) => s.theme)
  const paletteOpen = useWorkspace((s) => s.paletteOpen)
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen)
  const loadWorkspace = useWorkspace((s) => s.loadWorkspace)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    void loadWorkspace()
    // Runs once on mount — `loadWorkspace` is a stable zustand action
    // reference, and M1 has no live-reload/multi-window story yet (that's
    // `cobble-watcher`'s territory) so there's no reason to refetch later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(!paletteOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, setPaletteOpen])

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <MainView />
      </main>
      <CommandPalette />
    </div>
  )
}

export default App

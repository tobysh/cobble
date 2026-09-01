import { useEffect } from 'react'
import { CalendarView } from './calendar/CalendarView'
import { CommandPalette } from './command-palette/CommandPalette'
import { PageView } from './editor/PageView'
import { Sidebar } from './sidebar/Sidebar'
import { useWorkspace } from './state/store'
import './theme/tokens.css'
import './App.css'

function App() {
  const theme = useWorkspace((s) => s.theme)
  const view = useWorkspace((s) => s.view)
  const paletteOpen = useWorkspace((s) => s.paletteOpen)
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

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
        {view.kind === 'calendar' ? <CalendarView /> : <PageView pageId={view.pageId} />}
      </main>
      <CommandPalette />
    </div>
  )
}

export default App

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useWorkspace } from '../state/store'
import { CalendarGrid, type CalendarEntry } from './CalendarGrid'
import { MONTH_NAMES, WEEKDAYS } from './calendarDate'
import './calendar.css'

export function CalendarView() {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const pages = useWorkspace((s) => s.pages)
  const createDailyNote = useWorkspace((s) => s.createDailyNote)
  const openPage = useWorkspace((s) => s.openPage)

  const notesByDate = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of Object.values(pages)) {
      if (p.isDailyNote && p.date) map.set(p.date, p.id)
    }
    return map
  }, [pages])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  // One dot per day that already has a daily note — the day cell itself
  // (not this entry) is what's clickable, so the content is just the marker.
  const entries: CalendarEntry[] = useMemo(
    () => Array.from(notesByDate.keys()).map((date) => ({ date, content: <span className="calendar-note-dot" /> })),
    [notesByDate],
  )

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <h1>{MONTH_NAMES[month]} {year}</h1>
        <div className="calendar-nav">
          <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="calendar-today" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
            Today
          </button>
          <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <CalendarGrid
        year={year}
        month={month}
        today={today}
        entries={entries}
        cellClassName={(_iso, _date, hasEntries) => (hasEntries ? 'calendar-cell--has-note' : '')}
        onDateClick={(iso, date) => {
          const noteId = notesByDate.get(iso)
          if (noteId) {
            openPage(noteId)
            return
          }
          const label = `${WEEKDAYS[date.getDay()].slice(0, 3)}, ${MONTH_NAMES[month].slice(0, 3)} ${date.getDate()}`
          void createDailyNote(iso, label)
        }}
        renderEmptyCellContent={() => (
          <span className="calendar-add">
            <Plus size={12} />
          </span>
        )}
      />
    </div>
  )
}

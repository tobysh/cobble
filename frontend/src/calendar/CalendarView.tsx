import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useWorkspace } from '../state/store'
import './calendar.css'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

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
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (Date | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ]

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

      <div className="calendar-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-weekday">{w}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="calendar-cell calendar-cell--empty" />
          const iso = toISO(date)
          const isToday = iso === toISO(today)
          const noteId = notesByDate.get(iso)
          const label = `${WEEKDAYS[date.getDay()].slice(0, 3)}, ${MONTH_NAMES[month].slice(0, 3)} ${date.getDate()}`
          return (
            <button
              key={i}
              type="button"
              className={`calendar-cell${isToday ? ' calendar-cell--today' : ''}${noteId ? ' calendar-cell--has-note' : ''}`}
              onClick={() => (noteId ? openPage(noteId) : createDailyNote(iso, label))}
            >
              <span className="calendar-date">{date.getDate()}</span>
              {noteId ? (
                <span className="calendar-note-dot" />
              ) : (
                <span className="calendar-add">
                  <Plus size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

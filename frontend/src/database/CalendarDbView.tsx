import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CalendarGrid, type CalendarEntry } from '../calendar/CalendarGrid'
import { MONTH_NAMES } from '../calendar/calendarDate'
import '../calendar/calendar.css'
import { useWorkspace } from '../state/store'
import type { DatabaseSchema, PageId } from '../state/types'
import { useDatabaseRows } from './useDatabaseRows'
import './calendarDbView.css'

/**
 * Calendar view: plots each row onto a month grid by whichever of its `date`
 * -typed properties is selected, reusing the same `CalendarGrid` that powers
 * the global calendar (`calendar/CalendarView.tsx`) rather than a second
 * month-layout implementation. Unlike the global calendar (one daily note
 * per day, the *cell* is the click target), a database can have several rows
 * sharing a date, so each row renders as its own clickable entry inside the
 * cell — see `CalendarGrid`'s `entries` prop.
 */
export function CalendarDbView({ databaseId, schema }: { databaseId: PageId; schema: DatabaseSchema | undefined }) {
  const { rows, loading, error } = useDatabaseRows(databaseId)
  const openPage = useWorkspace((s) => s.openPage)
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedProp, setSelectedProp] = useState<string | null>(null)

  const dateProperties = useMemo(
    () => (schema?.properties ?? []).filter((p) => p.propertyType.type === 'date'),
    [schema],
  )
  const activeProp = selectedProp ?? dateProperties[0]?.name ?? null

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  const entries: CalendarEntry[] = useMemo(() => {
    if (!activeProp) return []
    const list: CalendarEntry[] = []
    for (const row of rows) {
      const value = row.properties[activeProp]
      if (value?.type !== 'date' || !value.value) continue
      // Values may be a bare date or a full datetime — the grid keys entries
      // by plain `yyyy-mm-dd`, matching `CalendarGrid`'s own `toISO`.
      const iso = value.value.slice(0, 10)
      list.push({
        date: iso,
        content: (
          <button
            key={row.id}
            type="button"
            className="calendar-db-entry"
            title={row.title || 'Untitled'}
            onClick={(e) => {
              e.stopPropagation()
              openPage(row.id)
            }}
          >
            {row.title || 'Untitled'}
          </button>
        ),
      })
    }
    return list
  }, [rows, activeProp, openPage])

  if (!schema) {
    return <div className="db-empty-state">This database has no schema yet.</div>
  }

  if (dateProperties.length === 0) {
    return <div className="db-empty-state">Add a date property to this database to use the calendar view.</div>
  }

  return (
    <div className="calendar-db-view">
      <div className="calendar-header">
        <h1>{MONTH_NAMES[month]} {year}</h1>
        <div className="calendar-nav">
          {dateProperties.length > 1 && (
            <select
              className="calendar-db-prop-select"
              value={activeProp ?? ''}
              onChange={(e) => setSelectedProp(e.target.value)}
              aria-label="Date property"
            >
              {dateProperties.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))}>
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="calendar-today"
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          >
            Today
          </button>
          <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {error && <div className="db-error-banner">{error}</div>}

      <CalendarGrid year={year} month={month} today={today} entries={entries} />

      {loading && rows.length === 0 && <div className="db-loading">Loading rows…</div>}
    </div>
  )
}

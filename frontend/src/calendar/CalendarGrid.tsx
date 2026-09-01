import { useMemo, type ReactNode } from 'react'
import { WEEKDAYS, toISO } from './calendarDate'

// Reusable month-grid layout, factored out of `CalendarView.tsx` so the
// database calendar view (`database/CalendarDbView.tsx`) can plot its own
// per-row entries onto the same grid instead of re-implementing month-layout
// math. `CalendarView` is the only caller that needs whole-cell click
// behavior (open the day's note, or create one) and a single-note-per-day
// model; `CalendarDbView` instead has zero-to-many entries per day, so the
// shared surface is deliberately just "layout + per-day content", not
// per-day click semantics — those stay caller-specific via `onDateClick`.

/** One piece of content to plot on a given day. Multiple entries may share a date. */
export interface CalendarEntry {
  date: string // ISO yyyy-mm-dd
  content: ReactNode
}

export interface CalendarGridProps {
  /** Full year, e.g. 2026. */
  year: number
  /** 0-indexed month (`0` = January), matching `Date.getMonth()`. */
  month: number
  /** Used only to mark the current day's cell — omit to render with no "today" highlight. */
  today?: Date
  entries: CalendarEntry[]
  /**
   * Fired when a day cell (not one of its entries) is clicked. When set, the
   * cell renders as a real `<button>` (matching the global calendar's prior
   * behavior); when omitted, it renders as a plain `<div>` so entries with
   * their own click handlers (e.g. a database row's open-page button) don't
   * end up nested inside another interactive element.
   */
  onDateClick?: (iso: string, date: Date) => void
  /** Extra class name(s) for a day's cell, e.g. to mark "has an entry". */
  cellClassName?: (iso: string, date: Date, hasEntries: boolean) => string
  /** Content to show on a day with no entries (e.g. the global calendar's hover-to-add affordance). */
  renderEmptyCellContent?: (iso: string, date: Date) => ReactNode
}

export function CalendarGrid({
  year,
  month,
  today,
  entries,
  onDateClick,
  cellClassName,
  renderEmptyCellContent,
}: CalendarGridProps) {
  const entriesByDate = useMemo(() => {
    const map = new Map<string, ReactNode[]>()
    for (const entry of entries) {
      const list = map.get(entry.date)
      if (list) list.push(entry.content)
      else map.set(entry.date, [entry.content])
    }
    return map
  }, [entries])

  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ]

  return (
    <div className="calendar-grid">
      {WEEKDAYS.map((w) => (
        <div key={w} className="calendar-weekday">{w}</div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={i} className="calendar-cell calendar-cell--empty" />

        const iso = toISO(date)
        const isToday = today ? iso === toISO(today) : false
        const dayEntries = entriesByDate.get(iso)
        const extra = cellClassName?.(iso, date, !!dayEntries?.length) ?? ''
        const className = `calendar-cell${isToday ? ' calendar-cell--today' : ''}${extra ? ` ${extra}` : ''}`
        const body = (
          <>
            <span className="calendar-date">{date.getDate()}</span>
            {dayEntries?.length ? dayEntries : renderEmptyCellContent?.(iso, date)}
          </>
        )

        if (onDateClick) {
          return (
            <button key={i} type="button" className={className} onClick={() => onDateClick(iso, date)}>
              {body}
            </button>
          )
        }
        return (
          <div key={i} className={className}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

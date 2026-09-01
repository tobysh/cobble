import { useCallback, useEffect, useState } from 'react'
import { api } from '../state/api'
import type { Page, PageId, PropertyValue } from '../state/types'

// Data-fetching layer for a database's rows — deliberately independent of
// `state/store.ts` (which owns the *page tree*, not row data) so the
// board/list/gallery views planned for later M3 tasks can reuse this same
// hook against their own render, not just table view. Owns exactly one
// database's rows; nothing here assumes "table" semantics.
//
// Follows the optimistic-update shape `state/store.ts` already uses
// elsewhere (`saveBlocks`, `createDailyNote`): update local state first so
// the UI feels instant, then reconcile with whatever the backend actually
// persisted once the write comes back — and on failure, refetch from the
// backend rather than leaving optimistic state that never happened on disk.

export interface UseDatabaseRows {
  rows: Page[]
  loading: boolean
  /** Message from the most recent failed mutation, if any — cleared on the next successful one. */
  error: string | null
  reload: () => Promise<void>
  /** Sets one cell's value; pass `value: null` to clear it. */
  updateCell: (rowId: PageId, propertyName: string, value: PropertyValue | null) => Promise<void>
  renameRow: (rowId: PageId, title: string) => Promise<void>
  addRow: (title?: string) => Promise<Page>
  deleteRow: (rowId: PageId) => Promise<void>
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useDatabaseRows(databaseId: PageId): UseDatabaseRows {
  const [rows, setRows] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const fetched = await api.listDatabaseRows(databaseId)
      setRows(fetched)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setLoading(false)
    }
  }, [databaseId])

  useEffect(() => {
    // Fetching from the Tauri backend on mount/`databaseId` change is
    // exactly "synchronizing with an external system" — the pattern this
    // lint rule is meant to steer people away from an effect *for*, not
    // this one.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

  const updateCell = useCallback(
    async (rowId: PageId, propertyName: string, value: PropertyValue | null) => {
      const previous = rows
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row
          const properties = { ...row.properties }
          if (value === null) delete properties[propertyName]
          else properties[propertyName] = value
          return { ...row, properties }
        }),
      )
      try {
        const saved = await api.updateRowProperty(rowId, propertyName, value)
        setRows((prev) => prev.map((row) => (row.id === rowId ? saved : row)))
        setError(null)
      } catch (err) {
        // The write was rejected (most likely a schema validation error —
        // wrong type, or a select value outside the option list) before
        // anything touched disk, so the optimistic edit above is now wrong.
        // Roll back to the last known-good state rather than leaving a cell
        // showing a value that was never actually saved.
        setRows(previous)
        setError(messageOf(err))
        throw err
      }
    },
    [rows],
  )

  const renameRow = useCallback(
    async (rowId: PageId, title: string) => {
      const previous = rows
      setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, title } : row)))
      try {
        const saved = await api.renamePage(rowId, title)
        setRows((prev) => prev.map((row) => (row.id === rowId ? saved : row)))
        setError(null)
      } catch (err) {
        setRows(previous)
        setError(messageOf(err))
        throw err
      }
    },
    [rows],
  )

  const addRow = useCallback(
    async (title = 'Untitled') => {
      const created = await api.createDatabaseRow(databaseId, title)
      setRows((prev) => [...prev, created])
      return created
    },
    [databaseId],
  )

  const deleteRow = useCallback(async (rowId: PageId) => {
    const previous = rows
    setRows((prev) => prev.filter((row) => row.id !== rowId))
    try {
      await api.deletePage(rowId)
      setError(null)
    } catch (err) {
      setRows(previous)
      setError(messageOf(err))
      throw err
    }
  }, [rows])

  return { rows, loading, error, reload, updateCell, renameRow, addRow, deleteRow }
}

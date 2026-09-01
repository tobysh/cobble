import { useMemo } from 'react'
import type { DatabaseSchema, Page } from '../state/types'
import type { DatabaseQuery, RowGroup } from './query'
import { applyDatabaseQuery, groupRows } from './query'

export interface FilteredSortedRows {
  /** `rows` after `query.filters`/`query.sort`, in final display order. */
  rows: Page[]
  /** Present only when `query.groupBy` is set — `rows` bucketed into
   * sections, each already filtered/sorted, in the same order they'd appear
   * flattened back together. `null` means "render `rows` ungrouped". */
  groups: RowGroup[] | null
}

/**
 * Wraps the rows `useDatabaseRows` fetches with client-side filter/sort/group
 * (`query.ts`), applied fresh on every render via `useMemo` — no additional
 * fetching, no change to `useDatabaseRows`'s own return shape. Kept as a
 * separate hook rather than a `useDatabaseRows` option so it composes with
 * *any* row source a view has already fetched, and so `TableView`'s existing
 * `useDatabaseRows` call sites elsewhere don't need to change to pick this
 * up — a view opts in by feeding its `rows` through this too.
 */
export function useFilteredSortedRows(
  rows: Page[],
  schema: DatabaseSchema | undefined,
  query: DatabaseQuery,
): FilteredSortedRows {
  return useMemo(() => {
    if (!schema) return { rows, groups: null }
    const filteredSorted = applyDatabaseQuery(rows, schema, query)
    const groups = query.groupBy ? groupRows(filteredSorted, schema, query.groupBy) : null
    return { rows: filteredSorted, groups }
  }, [rows, schema, query])
}

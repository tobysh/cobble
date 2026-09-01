import { useState, type ReactNode } from 'react'
import type { DatabaseSchema, Page, PageId, PropertyDefinition } from '../state/types'
import { PropertyCell } from './Cell'
import { emptyQuery, type DatabaseQuery, type RowGroup } from './query'
import { QueryToolbar } from './QueryToolbar'
import { useDatabaseRows } from './useDatabaseRows'
import { useFilteredSortedRows } from './useFilteredSortedRows'
import './database.css'

/**
 * Table view: rows (database children) × typed-property columns. The first
 * of several planned database views (board/list/gallery/calendar are
 * separate later tasks) — everything view-specific lives in `database/`,
 * while `useDatabaseRows` (row fetch + mutations) is written to be reused by
 * those views rather than rebuilt per view.
 *
 * Filter/sort/group (`query.ts`) is layered on top via `useFilteredSortedRows`
 * rather than folded into `useDatabaseRows` itself, so it stays reusable by
 * the sibling board/list/gallery/calendar views once their branches are
 * reconciled with this one — they'd feed their own fetched rows through the
 * same hook rather than adopting table-specific code.
 */
export function TableView({ databaseId, schema }: { databaseId: PageId; schema: DatabaseSchema | undefined }) {
  const { rows, loading, error, updateCell, renameRow, addRow, deleteRow } = useDatabaseRows(databaseId)
  const [hoveredRow, setHoveredRow] = useState<PageId | null>(null)
  const [query, setQuery] = useState<DatabaseQuery>(emptyQuery)
  const { rows: visibleRows, groups } = useFilteredSortedRows(rows, schema, query)

  if (!schema) {
    return <div className="db-empty-state">This database has no schema yet.</div>
  }

  const properties = schema.properties

  const renderRow = (row: Page) => (
    <tr key={row.id} onMouseEnter={() => setHoveredRow(row.id)} onMouseLeave={() => setHoveredRow(null)}>
      <td className="db-col-title">
        <RowTitleCell title={row.title} onCommit={(title) => void renameRow(row.id, title)} />
      </td>
      {properties.map((prop) => (
        <td key={prop.name}>
          <PropertyCell
            definition={prop}
            value={row.properties[prop.name]}
            onChange={(value) => void updateCell(row.id, prop.name, value)}
          />
        </td>
      ))}
      <td className="db-col-actions">
        {hoveredRow === row.id && (
          <button
            type="button"
            className="db-row-delete"
            aria-label="Delete row"
            title="Delete row"
            onClick={() => void deleteRow(row.id)}
          >
            ×
          </button>
        )}
      </td>
    </tr>
  )

  return (
    <div className="db-table-view">
      <QueryToolbar schema={schema} query={query} onChange={setQuery} />
      {error && <div className="db-error-banner">{error}</div>}
      <div className="db-table-scroll">
        <table className="db-table">
          <thead>
            <tr>
              <th className="db-col-title">Name</th>
              {properties.map((prop) => (
                <th key={prop.name}>{prop.name}</th>
              ))}
              <th className="db-col-actions" aria-hidden="true" />
            </tr>
          </thead>
          {groups ? (
            groups.map((group) => <GroupBody key={group.key} group={group} properties={properties} renderRow={renderRow} />)
          ) : (
            <tbody>{visibleRows.map(renderRow)}</tbody>
          )}
        </table>
      </div>

      {loading && rows.length === 0 ? (
        <div className="db-loading">Loading rows…</div>
      ) : (
        <button type="button" className="db-add-row" onClick={() => void addRow()}>
          + New
        </button>
      )}
    </div>
  )
}

/** One collapsible group section — a header row spanning every column,
 * followed by that bucket's rows. Uses `<tbody>` per group (each with its
 * own header `<tr>`) so section boundaries stay valid HTML table structure
 * while still collapsing/expanding independently via `<details>`-less native
 * `hidden` state kept per group. */
function GroupBody({
  group,
  properties,
  renderRow,
}: {
  group: RowGroup
  properties: PropertyDefinition[]
  renderRow: (row: Page) => ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const columnCount = properties.length + 2 // + title column + actions column

  return (
    <tbody className="db-group-body">
      <tr className="db-group-header-row">
        <td colSpan={columnCount}>
          <button type="button" className="db-group-header" onClick={() => setCollapsed((c) => !c)}>
            <span className={collapsed ? 'db-group-caret db-group-caret--collapsed' : 'db-group-caret'}>▾</span>
            {group.color ? (
              <span className="db-tag" style={{ color: `var(--tag-${group.color})`, background: `var(--tag-${group.color}-soft)` }}>
                {group.label}
              </span>
            ) : (
              <span className="db-group-label">{group.label}</span>
            )}
            <span className="db-group-count">{group.rows.length}</span>
          </button>
        </td>
      </tr>
      {!collapsed && group.rows.map(renderRow)}
    </tbody>
  )
}

function RowTitleCell({ title, onCommit }: { title: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(title)
  // See the identical comment in `database/Cell.tsx`'s `TextCell`.
  const [prevTitle, setPrevTitle] = useState(title)
  if (title !== prevTitle) {
    setPrevTitle(title)
    setDraft(title)
  }

  return (
    <input
      className="db-cell-input db-cell-input--title"
      type="text"
      value={draft}
      placeholder="Untitled"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== title) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

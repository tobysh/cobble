import { useState } from 'react'
import type { DatabaseSchema, PageId } from '../state/types'
import { PropertyCell } from './Cell'
import { useDatabaseRows } from './useDatabaseRows'
import './database.css'

/**
 * Table view: rows (database children) × typed-property columns. The first
 * of several planned database views (board/list/gallery/calendar are
 * separate later tasks) — everything view-specific lives in `database/`,
 * while `useDatabaseRows` (row fetch + mutations) is written to be reused by
 * those views rather than rebuilt per view.
 */
export function TableView({ databaseId, schema }: { databaseId: PageId; schema: DatabaseSchema | undefined }) {
  const { rows, loading, error, updateCell, renameRow, addRow, deleteRow } = useDatabaseRows(databaseId)
  const [hoveredRow, setHoveredRow] = useState<PageId | null>(null)

  if (!schema) {
    return <div className="db-empty-state">This database has no schema yet.</div>
  }

  const properties = schema.properties

  return (
    <div className="db-table-view">
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
          <tbody>
            {rows.map((row) => (
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
            ))}
          </tbody>
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

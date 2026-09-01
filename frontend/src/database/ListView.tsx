import { useMemo, useState } from 'react'
import { useWorkspace } from '../state/store'
import type { DatabaseSchema, Page, PageId, PropertyDefinition, PropertyValue } from '../state/types'
import { PropertyCell } from './Cell'
import { useDatabaseRows } from './useDatabaseRows'
import './list-view.css'

const DEFAULT_VISIBLE_COUNT = 3

/**
 * List view: one row per line — a title plus a compact horizontal strip of a
 * handful of chosen properties. Denser than `TableView` and has no fixed
 * columns, so it's better for browsing than bulk-editing. Reuses
 * `useDatabaseRows` for data and `Cell.tsx`'s `PropertyCell` (in its
 * `compact` mode, see that file) for the strip, same as `TableView` does for
 * its columns — so every property type edits identically in both views.
 */
export function ListView({ databaseId, schema }: { databaseId: PageId; schema: DatabaseSchema | undefined }) {
  const { rows, loading, error, updateCell, addRow } = useDatabaseRows(databaseId)
  const openPage = useWorkspace((s) => s.openPage)

  const properties = useMemo(() => schema?.properties ?? [], [schema])
  const propertyNames = useMemo(() => new Set(properties.map((p) => p.name)), [properties])

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(properties.slice(0, DEFAULT_VISIBLE_COUNT).map((p) => p.name)),
  )
  // If the schema's properties change shape (one added/removed elsewhere),
  // drop selections that no longer exist — adjusted during render rather
  // than via an effect, per the identical pattern in `database/Cell.tsx`'s
  // `TextCell` (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [prevPropertyNames, setPrevPropertyNames] = useState(propertyNames)
  if (propertyNames !== prevPropertyNames) {
    setPrevPropertyNames(propertyNames)
    setVisible((prev) => {
      const next = new Set([...prev].filter((n) => propertyNames.has(n)))
      return next.size === prev.size ? prev : next
    })
  }

  if (!schema) {
    return <div className="db-empty-state">This database has no schema yet.</div>
  }

  const toggleVisible = (name: string) => {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const visibleProps = properties.filter((p) => visible.has(p.name))

  return (
    <div className="db-list-view">
      {error && <div className="db-error-banner">{error}</div>}

      <div className="db-list-toolbar">
        <PropertyPicker properties={properties} visible={visible} onToggle={toggleVisible} />
      </div>

      <div className="db-list-rows">
        {rows.map((row) => (
          <ListRow
            key={row.id}
            row={row}
            properties={visibleProps}
            onOpen={() => openPage(row.id)}
            onChangeProperty={(name, value) => void updateCell(row.id, name, value)}
          />
        ))}
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

function PropertyPicker({
  properties,
  visible,
  onToggle,
}: {
  properties: PropertyDefinition[]
  visible: Set<string>
  onToggle: (name: string) => void
}) {
  return (
    <details className="db-list-picker">
      <summary className="db-list-picker-summary">Properties</summary>
      <div className="db-list-picker-menu">
        {properties.length === 0 && <div className="db-cell-empty">No properties on this database.</div>}
        {properties.map((prop) => (
          <label key={prop.name} className="db-list-picker-option">
            <input type="checkbox" checked={visible.has(prop.name)} onChange={() => onToggle(prop.name)} />
            {prop.name}
          </label>
        ))}
      </div>
    </details>
  )
}

function ListRow({
  row,
  properties,
  onOpen,
  onChangeProperty,
}: {
  row: Page
  properties: PropertyDefinition[]
  onOpen: () => void
  onChangeProperty: (name: string, value: PropertyValue | null) => void
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="db-list-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <div className="db-list-row-title">
        {row.icon && <span className="db-list-row-icon">{row.icon}</span>}
        <span className="db-list-row-title-text">{row.title || 'Untitled'}</span>
      </div>

      {properties.length > 0 && (
        <div className="db-list-row-strip" onClick={(e) => e.stopPropagation()}>
          {properties.map((prop) => (
            <div key={prop.name} className="db-list-row-cell" title={prop.name}>
              <PropertyCell
                definition={prop}
                value={row.properties[prop.name]}
                onChange={(value) => onChangeProperty(prop.name, value)}
                compact
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

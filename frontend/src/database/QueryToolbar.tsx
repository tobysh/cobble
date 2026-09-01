import { useRef, useState } from 'react'
import type { DatabaseSchema, PropertyType } from '../state/types'
import { useClosePopover } from './usePopover'
import type { DatabaseQuery, Filter, FilterOperator, Sort } from './query'
import { operatorsFor, TITLE_PROPERTY } from './query'

// Toolbar for `TableView`'s filter/sort/group-by controls, built on the same
// zero-JS-listener `<details>` popover pattern as `Cell.tsx`'s select cells.
// Talks to the rest of the view only through `DatabaseQuery` (`query.ts`) —
// nothing here knows about rows or rendering, so a board/list/gallery view
// can drop this same component in once it adopts `DatabaseQuery`.

type PropertyKind = PropertyType['type'] | 'title'

interface PropertyOption {
  name: string
  label: string
  kind: PropertyKind
}

function propertyOptions(schema: DatabaseSchema): PropertyOption[] {
  return [
    { name: TITLE_PROPERTY, label: 'Name', kind: 'title' },
    ...schema.properties.map((p) => ({ name: p.name, label: p.name, kind: p.propertyType.type })),
  ]
}

function kindOf(options: PropertyOption[], name: string): PropertyKind {
  return options.find((o) => o.name === name)?.kind ?? 'title'
}

function optionsOf(schema: DatabaseSchema, name: string): { name: string }[] {
  const def = schema.properties.find((p) => p.name === name)
  if (def?.propertyType.type === 'select' || def?.propertyType.type === 'multi_select') {
    return def.propertyType.config.options
  }
  return []
}

export function QueryToolbar({
  schema,
  query,
  onChange,
}: {
  schema: DatabaseSchema
  query: DatabaseQuery
  onChange: (query: DatabaseQuery) => void
}) {
  const properties = propertyOptions(schema)

  return (
    <div className="db-toolbar">
      <FilterPopover properties={properties} schema={schema} query={query} onChange={onChange} />
      <SortPopover properties={properties} query={query} onChange={onChange} />
      <GroupPopover properties={properties} query={query} onChange={onChange} />
    </div>
  )
}

function FilterPopover({
  properties,
  schema,
  query,
  onChange,
}: {
  properties: PropertyOption[]
  schema: DatabaseSchema
  query: DatabaseQuery
  onChange: (query: DatabaseQuery) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  useClosePopover(open, ref)
  const filters = query.filters

  const update = (index: number, next: Filter) => {
    onChange({ ...query, filters: filters.map((f, i) => (i === index ? next : f)) })
  }
  const remove = (index: number) => {
    onChange({ ...query, filters: filters.filter((_, i) => i !== index) })
  }
  const add = () => {
    const first = properties[0]
    const operator = operatorsFor(first.kind)[0].value
    onChange({ ...query, filters: [...filters, { property: first.name, operator }] })
  }

  return (
    <details ref={ref} className="db-toolbar-popover" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="db-toolbar-btn">
        Filter{filters.length > 0 && <span className="db-toolbar-count">{filters.length}</span>}
      </summary>
      <div className="db-toolbar-panel">
        {filters.length === 0 && <p className="db-toolbar-empty">No filters</p>}
        {filters.map((filter, index) => (
          <FilterRow
            key={index}
            filter={filter}
            properties={properties}
            schema={schema}
            onChange={(next) => update(index, next)}
            onRemove={() => remove(index)}
          />
        ))}
        <button type="button" className="db-toolbar-add" onClick={add}>
          + Add filter
        </button>
      </div>
    </details>
  )
}

function FilterRow({
  filter,
  properties,
  schema,
  onChange,
  onRemove,
}: {
  filter: Filter
  properties: PropertyOption[]
  schema: DatabaseSchema
  onChange: (filter: Filter) => void
  onRemove: () => void
}) {
  const kind = kindOf(properties, filter.property)
  const operators = operatorsFor(kind)
  const needsValue = filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty'

  const setProperty = (name: string) => {
    const nextKind = kindOf(properties, name)
    onChange({ property: name, operator: operatorsFor(nextKind)[0].value })
  }

  return (
    <div className="db-toolbar-row">
      <select
        className="db-toolbar-select"
        value={filter.property}
        onChange={(e) => setProperty(e.target.value)}
      >
        {properties.map((p) => (
          <option key={p.name} value={p.name}>
            {p.label}
          </option>
        ))}
      </select>
      <select
        className="db-toolbar-select"
        value={filter.operator}
        onChange={(e) => onChange({ ...filter, operator: e.target.value as FilterOperator, value: undefined })}
      >
        {operators.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      {needsValue && (
        <FilterValueInput kind={kind} property={filter.property} schema={schema} value={filter.value} onChange={(value) => onChange({ ...filter, value })} />
      )}
      <button type="button" className="db-toolbar-remove" aria-label="Remove filter" onClick={onRemove}>
        ×
      </button>
    </div>
  )
}

function FilterValueInput({
  kind,
  property,
  schema,
  value,
  onChange,
}: {
  kind: PropertyKind
  property: string
  schema: DatabaseSchema
  value: string | number | boolean | undefined
  onChange: (value: string | number | boolean) => void
}) {
  switch (kind) {
    case 'number':
      return (
        <input
          className="db-toolbar-input"
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      )
    case 'date':
      return (
        <input
          className="db-toolbar-input"
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'checkbox':
      return (
        <select
          className="db-toolbar-select"
          value={value === false ? 'false' : 'true'}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">checked</option>
          <option value="false">unchecked</option>
        </select>
      )
    case 'select':
    case 'multi_select': {
      const options = optionsOf(schema, property)
      return (
        <select className="db-toolbar-select" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            Choose…
          </option>
          {options.map((o) => (
            <option key={o.name} value={o.name}>
              {o.name}
            </option>
          ))}
        </select>
      )
    }
    case 'title':
    case 'text':
    default:
      return (
        <input
          className="db-toolbar-input"
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

function SortPopover({
  properties,
  query,
  onChange,
}: {
  properties: PropertyOption[]
  query: DatabaseQuery
  onChange: (query: DatabaseQuery) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  useClosePopover(open, ref)
  const sorts = query.sort

  const update = (index: number, next: Sort) => {
    onChange({ ...query, sort: sorts.map((s, i) => (i === index ? next : s)) })
  }
  const remove = (index: number) => {
    onChange({ ...query, sort: sorts.filter((_, i) => i !== index) })
  }
  const add = () => {
    onChange({ ...query, sort: [...sorts, { property: properties[0].name, direction: 'asc' }] })
  }

  return (
    <details ref={ref} className="db-toolbar-popover" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="db-toolbar-btn">
        Sort{sorts.length > 0 && <span className="db-toolbar-count">{sorts.length}</span>}
      </summary>
      <div className="db-toolbar-panel">
        {sorts.length === 0 && <p className="db-toolbar-empty">No sorts</p>}
        {sorts.map((sort, index) => (
          <div className="db-toolbar-row" key={index}>
            <select
              className="db-toolbar-select"
              value={sort.property}
              onChange={(e) => update(index, { ...sort, property: e.target.value })}
            >
              {properties.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="db-toolbar-direction"
              onClick={() => update(index, { ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
            >
              {sort.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
            </button>
            <button type="button" className="db-toolbar-remove" aria-label="Remove sort" onClick={() => remove(index)}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="db-toolbar-add" onClick={add}>
          + Add sort
        </button>
      </div>
    </details>
  )
}

function GroupPopover({
  properties,
  query,
  onChange,
}: {
  properties: PropertyOption[]
  query: DatabaseQuery
  onChange: (query: DatabaseQuery) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  useClosePopover(open, ref)
  // Grouping rows by their own (per-row-unique) title isn't useful, so the
  // title pseudo-property is offered for filter/sort but not group-by.
  const groupable = properties.filter((p) => p.kind !== 'title')
  const current = properties.find((p) => p.name === query.groupBy)

  return (
    <details ref={ref} className="db-toolbar-popover" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="db-toolbar-btn">Group{current && <span className="db-toolbar-count">{current.label}</span>}</summary>
      <div className="db-toolbar-panel">
        <select
          className="db-toolbar-select"
          value={query.groupBy ?? ''}
          onChange={(e) => onChange({ ...query, groupBy: e.target.value === '' ? undefined : e.target.value })}
        >
          <option value="">None</option>
          {groupable.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    </details>
  )
}

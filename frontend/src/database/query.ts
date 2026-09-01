import type {
  DatabaseSchema,
  Page,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SelectOption,
  TagColor,
} from '../state/types'

// Client-side filter/sort/group over rows `useDatabaseRows` already fetched.
// Deliberately independent of `useDatabaseRows` (which owns fetch + mutation)
// and of `TableView` (which owns rendering) — `board`/`list`/`gallery`/
// `calendar` views on their sibling branches can import this same module
// once branches are reconciled, since none of it assumes table layout.
//
// Nothing here talks to the backend: a `DatabaseQuery` is just plain,
// JSON-serializable state that a view keeps (today, in `useState`; later,
// plausibly persisted onto `DatabaseView` alongside its `kind`).

/** Sentinel `Filter.property`/`Sort.property` referring to `Page.title`, which
 * isn't a `PropertyDefinition` — every row has one, so it's always offered
 * alongside the schema's real properties. */
export const TITLE_PROPERTY = '__title'

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'is'
  | 'is_not'
  | 'before'
  | 'after'
  | 'on'
  | 'is_empty'
  | 'is_not_empty'

export interface Filter {
  /** A `PropertyDefinition.name`, or `TITLE_PROPERTY`. */
  property: string
  operator: FilterOperator
  /** Omitted for the two empty-check operators, which need no comparison value. */
  value?: string | number | boolean
}

export interface Sort {
  property: string
  direction: 'asc' | 'desc'
}

/** A small, serializable query: everything a view needs to turn fetched rows
 * into what the user asked to see. Every field is optional/empty-default so
 * `{}` is a valid "no query" value. */
export interface DatabaseQuery {
  filters: Filter[]
  sort: Sort[]
  groupBy?: string
}

export function emptyQuery(): DatabaseQuery {
  return { filters: [], sort: [] }
}

/** One selectable operator, with the label a filter-builder UI should show. */
export interface OperatorOption {
  value: FilterOperator
  label: string
}

const TEXT_OPERATORS: OperatorOption[] = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const NUMBER_OPERATORS: OperatorOption[] = [
  { value: 'equals', label: '=' },
  { value: 'not_equals', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '≥' },
  { value: 'lte', label: '≤' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const CHECKBOX_OPERATORS: OperatorOption[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
]

const DATE_OPERATORS: OperatorOption[] = [
  { value: 'before', label: 'is before' },
  { value: 'after', label: 'is after' },
  { value: 'on', label: 'is on' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const SELECT_OPERATORS: OperatorOption[] = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const MULTI_SELECT_OPERATORS: OperatorOption[] = [
  { value: 'contains', label: 'has' },
  { value: 'not_contains', label: 'does not have' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

/** Which operators are valid for a given property type — mirrors the task's
 * spec (text: contains/equals; number: `<`/`>`/`=`; select: equals/is-empty;
 * checkbox: is/is-not; date: before/after/on) plus the empty-checks every
 * type gets for free. `TITLE_PROPERTY` behaves like `text`. */
export function operatorsFor(type: PropertyType['type'] | 'title'): OperatorOption[] {
  switch (type) {
    case 'title':
    case 'text':
      return TEXT_OPERATORS
    case 'number':
      return NUMBER_OPERATORS
    case 'checkbox':
      return CHECKBOX_OPERATORS
    case 'date':
      return DATE_OPERATORS
    case 'select':
      return SELECT_OPERATORS
    case 'multi_select':
      return MULTI_SELECT_OPERATORS
  }
}

function operatorNeedsValue(operator: FilterOperator): boolean {
  return operator !== 'is_empty' && operator !== 'is_not_empty'
}

/** Looks up a filter/sort's `property` against the schema, or synthesizes the
 * `title` pseudo-property for `TITLE_PROPERTY`. */
function resolveProperty(schema: DatabaseSchema, name: string): PropertyDefinition | 'title' | undefined {
  if (name === TITLE_PROPERTY) return 'title'
  return schema.properties.find((p) => p.name === name)
}

function textOf(value: PropertyValue | undefined): string {
  return value?.type === 'text' ? value.value : ''
}

function matchesFilter(row: Page, def: PropertyDefinition | 'title', filter: Filter): boolean {
  const { operator } = filter
  const filterValue = filter.value

  if (def === 'title') {
    const title = row.title
    switch (operator) {
      case 'contains':
        return title.toLowerCase().includes(String(filterValue ?? '').toLowerCase())
      case 'not_contains':
        return !title.toLowerCase().includes(String(filterValue ?? '').toLowerCase())
      case 'equals':
        return title === filterValue
      case 'not_equals':
        return title !== filterValue
      case 'is_empty':
        return title.trim() === ''
      case 'is_not_empty':
        return title.trim() !== ''
      default:
        return true
    }
  }

  const value = row.properties[def.name]

  switch (def.propertyType.type) {
    case 'text': {
      const text = textOf(value)
      const needle = String(filterValue ?? '').toLowerCase()
      switch (operator) {
        case 'contains':
          return text.toLowerCase().includes(needle)
        case 'not_contains':
          return !text.toLowerCase().includes(needle)
        case 'equals':
          return text === filterValue
        case 'not_equals':
          return text !== filterValue
        case 'is_empty':
          return text.trim() === ''
        case 'is_not_empty':
          return text.trim() !== ''
        default:
          return true
      }
    }
    case 'number': {
      const num = value?.type === 'number' ? value.value : null
      if (operator === 'is_empty') return num === null
      if (operator === 'is_not_empty') return num !== null
      if (num === null) return false
      const target = Number(filterValue)
      switch (operator) {
        case 'equals':
          return num === target
        case 'not_equals':
          return num !== target
        case 'gt':
          return num > target
        case 'lt':
          return num < target
        case 'gte':
          return num >= target
        case 'lte':
          return num <= target
        default:
          return true
      }
    }
    case 'checkbox': {
      const checked = value?.type === 'checkbox' ? value.value : false
      const target = Boolean(filterValue)
      switch (operator) {
        case 'is':
          return checked === target
        case 'is_not':
          return checked !== target
        default:
          return true
      }
    }
    case 'date': {
      const date = value?.type === 'date' ? value.value : ''
      switch (operator) {
        case 'is_empty':
          return date === ''
        case 'is_not_empty':
          return date !== ''
        case 'before':
          return date !== '' && date < String(filterValue ?? '')
        case 'after':
          return date !== '' && date > String(filterValue ?? '')
        case 'on':
          return date === filterValue
        default:
          return true
      }
    }
    case 'select': {
      const selected = value?.type === 'select' ? value.value : null
      switch (operator) {
        case 'equals':
          return selected === filterValue
        case 'not_equals':
          return selected !== filterValue
        case 'is_empty':
          return selected === null
        case 'is_not_empty':
          return selected !== null
        default:
          return true
      }
    }
    case 'multi_select': {
      const selected = value?.type === 'multi_select' ? value.value : []
      switch (operator) {
        case 'contains':
          return selected.includes(String(filterValue))
        case 'not_contains':
          return !selected.includes(String(filterValue))
        case 'is_empty':
          return selected.length === 0
        case 'is_not_empty':
          return selected.length > 0
        default:
          return true
      }
    }
  }
}

/** A single comparable primitive extracted from a row for a given sort/group
 * property — `null` means "no value", which sorting always pushes to the end
 * (independent of direction) and grouping always buckets as "No value". */
type Comparable = string | number | null

function comparableOf(row: Page, def: PropertyDefinition | 'title'): Comparable {
  if (def === 'title') return row.title.trim() === '' ? null : row.title

  const value = row.properties[def.name]
  switch (def.propertyType.type) {
    case 'text':
      return value?.type === 'text' && value.value !== '' ? value.value : null
    case 'number':
      return value?.type === 'number' ? value.value : null
    case 'checkbox':
      return value?.type === 'checkbox' ? (value.value ? 1 : 0) : 0
    case 'date':
      return value?.type === 'date' && value.value !== '' ? value.value : null
    case 'select': {
      if (value?.type !== 'select') return null
      // Sort by declared option order (e.g. Todo → In Progress → Done)
      // rather than alphabetically, since that's almost always the
      // meaningful order for a select column.
      const options = def.propertyType.config.options
      const index = options.findIndex((o) => o.name === value.value)
      return index === -1 ? value.value : index
    }
    case 'multi_select':
      return value?.type === 'multi_select' && value.value.length > 0 ? [...value.value].sort().join(', ') : null
  }
}

function compareComparable(a: Comparable, b: Comparable, direction: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  let cmp: number
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b
  else cmp = String(a).localeCompare(String(b))
  return direction === 'asc' ? cmp : -cmp
}

/** Applies `query.filters` (AND-combined) then `query.sort` (in priority
 * order) to `rows`. Pure and side-effect-free — safe to call on every
 * render/`useMemo`. Unknown/stale `property` names (e.g. a column that was
 * since removed from the schema) are ignored rather than thrown on, so a
 * saved query never crashes the view. */
export function applyDatabaseQuery(rows: Page[], schema: DatabaseSchema, query: DatabaseQuery): Page[] {
  let result = rows

  const activeFilters = query.filters
    .map((f) => ({ filter: f, def: resolveProperty(schema, f.property) }))
    .filter((f): f is { filter: Filter; def: PropertyDefinition | 'title' } => f.def !== undefined)
    .filter((f) => !operatorNeedsValue(f.filter.operator) || f.filter.value !== undefined)

  if (activeFilters.length > 0) {
    result = result.filter((row) => activeFilters.every(({ filter, def }) => matchesFilter(row, def, filter)))
  }

  const activeSorts = query.sort
    .map((s) => ({ sort: s, def: resolveProperty(schema, s.property) }))
    .filter((s): s is { sort: Sort; def: PropertyDefinition | 'title' } => s.def !== undefined)

  if (activeSorts.length > 0) {
    result = [...result].sort((a, b) => {
      for (const { sort, def } of activeSorts) {
        const cmp = compareComparable(comparableOf(a, def), comparableOf(b, def), sort.direction)
        if (cmp !== 0) return cmp
      }
      return 0
    })
  }

  return result
}

/** One section of a grouped view: a bucket of rows sharing the same value of
 * the group-by property, plus display info for its header. */
export interface RowGroup {
  /** Stable identity for the bucket — the raw value as a string, or `'\0empty'`. */
  key: string
  label: string
  color?: TagColor
  rows: Page[]
}

const EMPTY_GROUP_KEY = '\0empty'

/** Buckets `rows` by `groupByProperty`'s value, in ascending order of that
 * value, with the "no value" bucket always last. A `multi_select` property
 * groups by the row's full tag set (joined) rather than fanning a
 * multi-tagged row out into every tag's group — simplest generic behavior;
 * a per-tag fan-out is a reasonable follow-up if a view wants it. */
export function groupRows(rows: Page[], schema: DatabaseSchema, groupByProperty: string): RowGroup[] {
  const def = resolveProperty(schema, groupByProperty)
  if (!def) return [{ key: '', label: '', rows }]

  const options: SelectOption[] =
    def !== 'title' && (def.propertyType.type === 'select' || def.propertyType.type === 'multi_select')
      ? def.propertyType.config.options
      : []

  const buckets = new Map<string, RowGroup>()

  for (const row of rows) {
    const comparable = comparableOf(row, def)
    const rowValue = def !== 'title' ? row.properties[def.name] : undefined

    let key: string
    let label: string
    let color: TagColor | undefined

    if (comparable === null) {
      key = EMPTY_GROUP_KEY
      label = 'No value'
    } else if (def !== 'title' && def.propertyType.type === 'select') {
      const selected = rowValue?.type === 'select' ? rowValue.value : null
      key = selected ?? EMPTY_GROUP_KEY
      label = selected ?? 'No value'
      color = options.find((o) => o.name === selected)?.color
    } else if (def !== 'title' && def.propertyType.type === 'multi_select') {
      const tags = rowValue?.type === 'multi_select' ? rowValue.value : []
      key = [...tags].sort().join(', ')
      label = tags.length > 0 ? tags.join(', ') : 'No value'
    } else if (def !== 'title' && def.propertyType.type === 'checkbox') {
      key = comparable === 1 ? 'true' : 'false'
      label = comparable === 1 ? 'Checked' : 'Unchecked'
    } else {
      key = String(comparable)
      label = String(comparable)
    }

    const existing = buckets.get(key)
    if (existing) existing.rows.push(row)
    else buckets.set(key, { key, label, color, rows: [row] })
  }

  const groups = [...buckets.values()]
  groups.sort((a, b) => {
    if (a.key === EMPTY_GROUP_KEY) return 1
    if (b.key === EMPTY_GROUP_KEY) return -1
    return a.label.localeCompare(b.label)
  })
  return groups
}

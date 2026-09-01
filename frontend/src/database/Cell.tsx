import { useRef, useState } from 'react'
import type { PropertyDefinition, PropertyValue, SelectOption, TagColor } from '../state/types'
import { useClosePopover } from './usePopover'

// One cell renderer/editor per `PropertyType` — the table view's columns are
// typed via `PropertyDefinition.propertyType`, and this is the only place
// that switches on that type to decide how a value reads and how it's
// edited. Kept independent of `TableView`'s layout so a future board/list/
// gallery view can reuse these same editors for the same property types.

/** A colored tag pill. The only place a `TagColor` ever becomes a visible
 * color — always through the `--tag-<color>`/`--tag-<color>-soft` token
 * pair, never a literal value (see "Theme tokens only" in CLAUDE.md). */
function TagPill({ name, color, onRemove }: { name: string; color: TagColor; onRemove?: () => void }) {
  return (
    <span className="db-tag" style={{ color: `var(--tag-${color})`, background: `var(--tag-${color}-soft)` }}>
      {name}
      {onRemove && (
        <button
          type="button"
          className="db-tag-remove"
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}

export function PropertyCell({
  definition,
  value,
  onChange,
}: {
  definition: PropertyDefinition
  value: PropertyValue | undefined
  onChange: (value: PropertyValue | null) => void
}) {
  const type = definition.propertyType

  switch (type.type) {
    case 'text':
      return <TextCell value={value?.type === 'text' ? value.value : ''} onChange={(v) => onChange(v === '' ? null : { type: 'text', value: v })} />

    case 'number':
      return (
        <NumberCell
          value={value?.type === 'number' ? value.value : null}
          onChange={(v) => onChange(v === null ? null : { type: 'number', value: v })}
        />
      )

    case 'checkbox':
      return (
        <CheckboxCell
          checked={value?.type === 'checkbox' ? value.value : false}
          onChange={(v) => onChange({ type: 'checkbox', value: v })}
        />
      )

    case 'date':
      return (
        <DateCell
          value={value?.type === 'date' ? value.value : ''}
          onChange={(v) => onChange(v === '' ? null : { type: 'date', value: v })}
        />
      )

    case 'select':
      return (
        <SelectCell
          options={type.config.options}
          selected={value?.type === 'select' ? value.value : null}
          onChange={(v) => onChange(v === null ? null : { type: 'select', value: v })}
        />
      )

    case 'multi_select':
      return (
        <MultiSelectCell
          options={type.config.options}
          selected={value?.type === 'multi_select' ? value.value : []}
          onChange={(v) => onChange(v.length === 0 ? null : { type: 'multi_select', value: v })}
        />
      )
  }
}

function TextCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  // Resyncs the edit buffer when `value` changes for a reason other than
  // this input's own `onChange` (a row reload, another view editing the
  // same cell) — adjusted during render rather than via an effect, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value)
  }

  return (
    <input
      className="db-cell-input"
      type="text"
      value={draft}
      placeholder="Empty"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onChange(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function NumberCell({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value === null ? '' : String(value))
  }

  const commit = () => {
    if (draft.trim() === '') {
      if (value !== null) onChange(null)
      return
    }
    const parsed = Number(draft)
    if (!Number.isNaN(parsed) && parsed !== value) onChange(parsed)
  }

  return (
    <input
      className="db-cell-input db-cell-input--number"
      type="number"
      value={draft}
      placeholder="Empty"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function CheckboxCell({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={checked ? 'db-checkbox db-checkbox--checked' : 'db-checkbox'}
      onClick={() => onChange(!checked)}
    />
  )
}

function DateCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input className="db-cell-input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}

function SelectCell({
  options,
  selected,
  onChange,
}: {
  options: SelectOption[]
  selected: string | null
  onChange: (value: string | null) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  useClosePopover(open, ref)
  const current = options.find((o) => o.name === selected) ?? null

  return (
    <details ref={ref} className="db-select-cell" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="db-select-summary">
        {current ? <TagPill name={current.name} color={current.color} /> : <span className="db-cell-empty">Empty</span>}
      </summary>
      <div className="db-select-menu">
        {options.map((option) => (
          <button
            key={option.name}
            type="button"
            className="db-select-option"
            onClick={() => {
              onChange(option.name === selected ? null : option.name)
              ref.current?.removeAttribute('open')
            }}
          >
            <TagPill name={option.name} color={option.color} />
            {option.name === selected && <span className="db-select-check">✓</span>}
          </button>
        ))}
      </div>
    </details>
  )
}

function MultiSelectCell({
  options,
  selected,
  onChange,
}: {
  options: SelectOption[]
  selected: string[]
  onChange: (value: string[]) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  useClosePopover(open, ref)
  const byName = new Map(options.map((o) => [o.name, o]))

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name])
  }

  return (
    <details ref={ref} className="db-select-cell" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="db-select-summary">
        {selected.length === 0 ? (
          <span className="db-cell-empty">Empty</span>
        ) : (
          <span className="db-tag-list">
            {selected.map((name) => {
              const option = byName.get(name)
              return option ? <TagPill key={name} name={option.name} color={option.color} onRemove={() => toggle(name)} /> : null
            })}
          </span>
        )}
      </summary>
      <div className="db-select-menu">
        {options.map((option) => (
          <button key={option.name} type="button" className="db-select-option" onClick={() => toggle(option.name)}>
            <TagPill name={option.name} color={option.color} />
            {selected.includes(option.name) && <span className="db-select-check">✓</span>}
          </button>
        ))}
      </div>
    </details>
  )
}

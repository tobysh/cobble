import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatabaseSchema, PageId, PropertyDefinition } from '../state/types'
import { useWorkspace } from '../state/store'
import { PropertyCell } from './Cell'
import { useDatabaseRows } from './useDatabaseRows'
import './gallery.css'

/**
 * Gallery view: one card per row, laid out in a CSS grid — Notion's
 * "gallery" view. Reuses `useDatabaseRows` for row data/mutations (same as
 * `TableView`) and `PropertyCell` for rendering/editing the couple of
 * properties shown under each card's title, so a property type only ever
 * gets one editor implementation across views.
 *
 * `PropertyType` (see `crates/cobble-core/src/database_schema.rs`) has no
 * dedicated image/attachment type yet, so there's no column a card cover can
 * come from automatically. Instead the user picks a `text` property to treat
 * as an image URL (a common workaround — e.g. a "Cover" text column holding
 * a link); if none is picked, or the picked property is empty for a row, or
 * the URL fails to load, the card falls back to a plain placeholder cover
 * rather than erroring. This is a deliberately small per-view choice, not a
 * saved-view-config system: it lives in this component's own state and
 * resets like any other view does when you leave the page (`PageView`
 * remounts per `pageId`).
 */

const MAX_DISPLAY_PROPERTIES = 2

export function GalleryView({ databaseId, schema }: { databaseId: PageId; schema: DatabaseSchema | undefined }) {
  const { rows, loading, error, updateCell, addRow, deleteRow } = useDatabaseRows(databaseId)
  const openPage = useWorkspace((s) => s.openPage)
  const [hoveredRow, setHoveredRow] = useState<PageId | null>(null)

  const properties = useMemo(() => schema?.properties ?? [], [schema])
  const textProperties = useMemo(() => properties.filter((p) => p.propertyType.type === 'text'), [properties])

  const [coverProperty, setCoverProperty] = useState<string | null>(null)
  const [displayProperties, setDisplayProperties] = useState<string[]>([])

  // Property names may disappear from the schema out from under this view's
  // local picks (schema editing isn't in scope for this task, but nothing
  // stops another view from doing it) — guard reads rather than assume.
  const coverDef = coverProperty ? properties.find((p) => p.name === coverProperty) : undefined
  const shownDefs = displayProperties
    .map((name) => properties.find((p) => p.name === name))
    .filter((p): p is PropertyDefinition => p !== undefined)

  if (!schema) {
    return <div className="db-empty-state">This database has no schema yet.</div>
  }

  return (
    <div className="gallery-view">
      {error && <div className="db-error-banner">{error}</div>}

      <GalleryConfigBar
        textProperties={textProperties}
        allProperties={properties}
        coverProperty={coverProperty}
        onCoverPropertyChange={setCoverProperty}
        displayProperties={displayProperties}
        onDisplayPropertiesChange={setDisplayProperties}
      />

      <div className="gallery-grid">
        {rows.map((row) => {
          const coverValue =
            coverDef && row.properties[coverDef.name]?.type === 'text'
              ? (row.properties[coverDef.name] as { type: 'text'; value: string }).value
              : ''

          return (
            <div key={row.id} className="gallery-card" onClick={() => openPage(row.id)}>
              <div
                className="gallery-card-cover"
                onMouseEnter={() => setHoveredRow(row.id)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {coverValue ? (
                  <GalleryCoverImage src={coverValue} />
                ) : (
                  <div className="gallery-card-cover-placeholder" aria-hidden="true">
                    <GalleryPlaceholderIcon />
                  </div>
                )}
                {hoveredRow === row.id && (
                  <button
                    type="button"
                    className="gallery-card-delete"
                    aria-label="Delete row"
                    title="Delete row"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteRow(row.id)
                    }}
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="gallery-card-body">
                <div className="gallery-card-title">{row.title || 'Untitled'}</div>
                {shownDefs.length > 0 && (
                  <div className="gallery-card-properties" onClick={(e) => e.stopPropagation()}>
                    {shownDefs.map((prop) => (
                      <div key={prop.name} className="gallery-card-property">
                        <span className="gallery-card-property-label">{prop.name}</span>
                        <PropertyCell
                          definition={prop}
                          value={row.properties[prop.name]}
                          onChange={(value) => void updateCell(row.id, prop.name, value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <button type="button" className="gallery-card gallery-card--add" onClick={() => void addRow()}>
          + New
        </button>
      </div>

      {loading && rows.length === 0 && <div className="db-loading">Loading rows…</div>}
    </div>
  )
}

/** An `<img>` that swaps to the placeholder cover on a bad/broken URL instead of showing a browser broken-image icon. */
function GalleryCoverImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  const [prevSrc, setPrevSrc] = useState(src)
  if (src !== prevSrc) {
    setPrevSrc(src)
    setFailed(false)
  }

  if (failed) {
    return (
      <div className="gallery-card-cover-placeholder" aria-hidden="true">
        <GalleryPlaceholderIcon />
      </div>
    )
  }

  return <img className="gallery-card-cover-image" src={src} alt="" onError={() => setFailed(true)} />
}

function GalleryPlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
      <path d="M3.5 17 L9 12 L13 15.5 L16 13 L20.5 17" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Closes an open `<details>` popover on outside click / Escape — identical to `Cell.tsx`'s `useClosePopover`. */
function useClosePopover(open: boolean, ref: React.RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') ref.current?.removeAttribute('open')
        return
      }
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.removeAttribute('open')
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open, ref])
}

function GalleryConfigBar({
  textProperties,
  allProperties,
  coverProperty,
  onCoverPropertyChange,
  displayProperties,
  onDisplayPropertiesChange,
}: {
  textProperties: PropertyDefinition[]
  allProperties: PropertyDefinition[]
  coverProperty: string | null
  onCoverPropertyChange: (name: string | null) => void
  displayProperties: string[]
  onDisplayPropertiesChange: (names: string[]) => void
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  useClosePopover(menuOpen, detailsRef)

  const toggleDisplayProperty = (name: string) => {
    if (displayProperties.includes(name)) {
      onDisplayPropertiesChange(displayProperties.filter((n) => n !== name))
      return
    }
    const next = [...displayProperties, name]
    // Cap at MAX_DISPLAY_PROPERTIES — drop the oldest pick rather than
    // refuse the new one, so the control always feels responsive.
    onDisplayPropertiesChange(next.length > MAX_DISPLAY_PROPERTIES ? next.slice(next.length - MAX_DISPLAY_PROPERTIES) : next)
  }

  return (
    <div className="gallery-config-bar">
      <label className="gallery-config-field">
        <span className="gallery-config-label">Cover</span>
        <select
          className="gallery-config-select"
          value={coverProperty ?? ''}
          onChange={(e) => onCoverPropertyChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">None</option>
          {textProperties.map((prop) => (
            <option key={prop.name} value={prop.name}>
              {prop.name}
            </option>
          ))}
        </select>
      </label>

      <details
        ref={detailsRef}
        className="gallery-config-field gallery-config-field--menu"
        onToggle={(e) => setMenuOpen(e.currentTarget.open)}
      >
        <summary className="gallery-config-summary">
          <span className="gallery-config-label">Show</span>
          <span className="gallery-config-summary-value">
            {displayProperties.length === 0 ? 'None' : displayProperties.join(', ')}
          </span>
        </summary>
        <div className="gallery-config-menu">
          {allProperties.length === 0 && <div className="gallery-config-menu-empty">No properties defined.</div>}
          {allProperties.map((prop) => (
            <label key={prop.name} className="gallery-config-menu-item">
              <input
                type="checkbox"
                checked={displayProperties.includes(prop.name)}
                onChange={() => toggleDisplayProperty(prop.name)}
              />
              {prop.name}
            </label>
          ))}
        </div>
      </details>
    </div>
  )
}

import { useEffect, useRef } from 'react'

interface EditableTextProps {
  value: string
  onChange: (text: string) => void
  placeholder?: string
  className?: string
  as?: 'div' | 'span'
  onSlashChange?: (query: string | null) => void
}

// Uncontrolled-by-design: the DOM is the source of truth while focused, we
// only sync `value` in on mount / block-identity change, never on every
// keystroke — otherwise the caret jumps on each store update.
export function EditableText({
  value,
  onChange,
  placeholder,
  className,
  as = 'div',
  onSlashChange,
}: EditableTextProps) {
  const ref = useRef<HTMLDivElement | HTMLSpanElement>(null)
  const lastSynced = useRef<string>(value)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (document.activeElement === el) return
    if (lastSynced.current === value && el.textContent === value) return
    el.textContent = value
    lastSynced.current = value
  }, [value])

  const Tag = as
  return (
    <Tag
      ref={ref as never}
      className={className}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(e) => {
        const text = (e.target as HTMLElement).textContent ?? ''
        lastSynced.current = text
        onChange(text)
        if (onSlashChange) {
          onSlashChange(text.startsWith('/') ? text.slice(1) : null)
        }
      }}
      onBlur={() => onSlashChange?.(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onSlashChange?.(null)
      }}
    />
  )
}

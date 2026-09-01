import { useEffect } from 'react'

/** Closes an open `<details>` popover on outside click / Escape / selection.
 * Shared by every `<details>`-based popover in `database/` — the select/
 * multi-select cells (`Cell.tsx`) and the filter/sort/group panels
 * (`QueryToolbar.tsx`). Split into its own module (rather than living in
 * `Cell.tsx`) so files that only render components can keep doing just that. */
export function useClosePopover(open: boolean, ref: React.RefObject<HTMLDetailsElement | null>) {
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

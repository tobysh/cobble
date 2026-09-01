/**
 * Declarative UI schema that plugins emit (see docs/ARCHITECTURE.md, "Plugin system"):
 * plugins never ship HTML/JS for their UI, only a small JSON widget tree over this
 * vocabulary. `UiSchemaRenderer` maps it onto the app's own themed React primitives,
 * which is what makes "plugins can't break theming" structural rather than conventional
 * — there is deliberately no `color`/`style`/`className`-passthrough field anywhere in
 * this vocabulary, so a plugin has no channel to specify a raw color even if it wanted to.
 *
 * This is the TS-side mirror of whatever shape crosses the WIT boundary as JSON
 * (`cobble-plugin-host`); treat values coming from a plugin as untrusted `unknown`,
 * not as this type directly — see `UiSchemaRenderer`'s runtime narrowing.
 */

export type UiSchemaNode = TextNode | HeadingNode | ButtonNode | ListNode | StackNode

/** Plain inline text, e.g. the hello-world sample plugin's `{"widget":"text","value":"Hello, world!"}`. */
export interface TextNode {
  widget: 'text'
  value: string
  /** Semantic emphasis only — never a raw color/weight/size override. */
  tone?: 'primary' | 'secondary' | 'tertiary'
}

/** A section heading. `level` maps to visual weight, not necessarily a raw `<h1>`-`<h3>`. */
export interface HeadingNode {
  widget: 'heading'
  value: string
  level?: 1 | 2 | 3
}

/**
 * A single action trigger. `onAction` is an opaque plugin-defined action id, not a
 * function — the host dispatches it back to the plugin's `on-event`/automation hook.
 * This component is presentational only; it surfaces the id via the `onAction` prop
 * rather than calling into the plugin host itself.
 */
export interface ButtonNode {
  widget: 'button'
  label: string
  onAction: string
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}

/** A bulleted/numbered list of child nodes. */
export interface ListNode {
  widget: 'list'
  items: UiSchemaNode[]
  ordered?: boolean
}

/** A layout container — vertical by default, matching the block editor's flow. */
export interface StackNode {
  widget: 'stack'
  children: UiSchemaNode[]
  direction?: 'vertical' | 'horizontal'
  gap?: 'sm' | 'md' | 'lg'
}

const KNOWN_WIDGETS = new Set<UiSchemaNode['widget']>([
  'text',
  'heading',
  'button',
  'list',
  'stack',
])

/**
 * Runtime type guard for `unknown` JSON coming from a plugin over the WIT boundary.
 * A malformed/future/disabled-plugin payload must degrade to a placeholder rather
 * than crash the renderer or the host page (see ARCHITECTURE.md's note on
 * `plugin_block` data degrading gracefully).
 */
export function isUiSchemaNode(value: unknown): value is UiSchemaNode {
  if (typeof value !== 'object' || value === null) return false
  const widget = (value as { widget?: unknown }).widget
  return typeof widget === 'string' && KNOWN_WIDGETS.has(widget as UiSchemaNode['widget'])
}

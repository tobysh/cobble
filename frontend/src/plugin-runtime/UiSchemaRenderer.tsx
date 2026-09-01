import type { ButtonNode, HeadingNode, ListNode, StackNode, TextNode } from './ui-schema'
import { isUiSchemaNode } from './ui-schema'
import './ui-schema.css'

export interface UiSchemaRendererProps {
  /**
   * The schema doc as a plugin emits it over the WIT boundary — plain JSON, not
   * necessarily a well-formed `UiSchemaNode` (a stale, misbehaving, or newer-version
   * plugin can send anything). Typed `unknown` deliberately; narrowed at render time.
   */
  schema: unknown
  /** Called with a `ButtonNode`'s `onAction` id when a plugin-declared action fires. */
  onAction?: (actionId: string) => void
}

/**
 * Renders a plugin's declarative UI schema using only the app's own themed React
 * primitives. Pure mapping, no `dangerouslySetInnerHTML`, no inline colors — every
 * visual choice here routes through `theme/tokens.css`'s semantic tokens via
 * `ui-schema.css`, because plugin content is untrusted (CLAUDE.md: "Theme tokens
 * only... this applies doubly to anything reachable from the plugin UiSchemaRenderer").
 *
 * Not wired to the plugin host IPC or `PluginBlockNode` here — this component only
 * takes a schema doc and (optionally) an action callback; a sibling task wires it
 * into the actual block/host plumbing.
 *
 * Usage:
 *   <UiSchemaRenderer
 *     schema={{ widget: 'text', value: 'Hello, world!' }}
 *     onAction={(id) => console.log('plugin action:', id)}
 *   />
 */
export function UiSchemaRenderer({ schema, onAction }: UiSchemaRendererProps) {
  return <>{renderNode(schema, onAction, 'root')}</>
}

function renderNode(value: unknown, onAction: ((actionId: string) => void) | undefined, key: string) {
  if (!isUiSchemaNode(value)) {
    return <UnknownWidget key={key} value={value} />
  }

  switch (value.widget) {
    case 'text':
      return <TextWidget key={key} node={value} />
    case 'heading':
      return <HeadingWidget key={key} node={value} />
    case 'button':
      return <ButtonWidget key={key} node={value} onAction={onAction} />
    case 'list':
      return <ListWidget key={key} node={value} onAction={onAction} />
    case 'stack':
      return <StackWidget key={key} node={value} onAction={onAction} />
    default: {
      // Exhaustiveness guard: a widget kind KNOWN_WIDGETS allows but this switch
      // doesn't handle yet degrades to a placeholder instead of throwing.
      const _exhaustive: never = value
      return <UnknownWidget value={_exhaustive} />
    }
  }
}

function TextWidget({ node }: { node: TextNode }) {
  const toneClass = node.tone ? ` ui-schema-text--${node.tone}` : ''
  return <p className={`ui-schema-text${toneClass}`}>{node.value}</p>
}

function HeadingWidget({ node }: { node: HeadingNode }) {
  const level = node.level ?? 1
  const className = `ui-schema-heading ui-schema-heading--${level}`
  if (level === 2) return <h2 className={className}>{node.value}</h2>
  if (level === 3) return <h3 className={className}>{node.value}</h3>
  return <h1 className={className}>{node.value}</h1>
}

function ButtonWidget({
  node,
  onAction,
}: {
  node: ButtonNode
  onAction: ((actionId: string) => void) | undefined
}) {
  const variantClass = ` ui-schema-button--${node.variant ?? 'secondary'}`
  return (
    <button
      type="button"
      className={`ui-schema-button${variantClass}`}
      disabled={node.disabled}
      onClick={() => onAction?.(node.onAction)}
    >
      {node.label}
    </button>
  )
}

function ListWidget({
  node,
  onAction,
}: {
  node: ListNode
  onAction: ((actionId: string) => void) | undefined
}) {
  const Tag = node.ordered ? 'ol' : 'ul'
  return (
    <Tag className="ui-schema-list">
      {node.items.map((item, i) => (
        <li key={i} className="ui-schema-list-item">
          {renderNode(item, onAction, `item-${i}`)}
        </li>
      ))}
    </Tag>
  )
}

function StackWidget({
  node,
  onAction,
}: {
  node: StackNode
  onAction: ((actionId: string) => void) | undefined
}) {
  const directionClass = node.direction === 'horizontal' ? ' ui-schema-stack--horizontal' : ''
  const gapClass = ` ui-schema-stack--gap-${node.gap ?? 'md'}`
  return (
    <div className={`ui-schema-stack${directionClass}${gapClass}`}>
      {node.children.map((child, i) => renderNode(child, onAction, `child-${i}`))}
    </div>
  )
}

/** Placeholder for malformed/unknown/disabled-plugin payloads — never crashes the host page. */
function UnknownWidget({ value }: { value: unknown }) {
  const widget =
    typeof value === 'object' && value !== null && 'widget' in value
      ? String((value as { widget: unknown }).widget)
      : typeof value
  return <div className="ui-schema-unknown">Unsupported plugin widget: {widget}</div>
}

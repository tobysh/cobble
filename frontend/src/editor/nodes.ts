import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import type { Klass, LexicalNode } from 'lexical'
import { ImageBlockNode } from './nodes/ImageBlockNode'
import { SubPageBlockNode } from './nodes/SubPageBlockNode'
import { TableBlockNode } from './nodes/TableBlockNode'
import { ToggleContainerNode, ToggleContentNode, ToggleTitleNode } from './nodes/ToggleNode'

// M2's remaining block types: quote/code come from `@lexical/rich-text` and
// `@lexical/code` respectively (single-`ElementNode` types, same shape as
// `HeadingNode`); toggle is a hand-rolled three-node collapsible (container/
// title/content — see `nodes/ToggleNode.ts`, since Lexical's own collapsible
// pattern is playground example code, not an installable package); image/
// table/sub-page are `DecoratorNode`s per `docs/ARCHITECTURE.md`'s content
// model. Anything still unregistered (currently nothing) degrades to a
// plain paragraph on import — see `serialization.ts`.
export const EDITOR_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  ListNode,
  ListItemNode,
  HorizontalRuleNode,
  QuoteNode,
  CodeNode,
  CodeHighlightNode,
  ToggleContainerNode,
  ToggleTitleNode,
  ToggleContentNode,
  ImageBlockNode,
  TableBlockNode,
  SubPageBlockNode,
]

// Theme class names, all resolving through `editor.css` -> `theme/tokens.css`
// semantic tokens. Reuses the class names the old per-block components used
// (`block-heading--1` etc.) so `editor.css` didn't need a parallel set of
// selectors for the same visual result.
export const editorTheme = {
  paragraph: 'block-text',
  heading: {
    h1: 'block-heading block-heading--1',
    h2: 'block-heading block-heading--2',
    h3: 'block-heading block-heading--3',
  },
  hr: 'block-divider',
  quote: 'block-quote',
  code: 'block-code',
  list: {
    checklist: 'editor-checklist',
    listitem: 'editor-listitem',
    listitemChecked: 'editor-listitem--checked',
    listitemUnchecked: 'editor-listitem--unchecked',
  },
}

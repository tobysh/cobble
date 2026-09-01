import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { HeadingNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import type { Klass, LexicalNode } from 'lexical'
import { PluginBlockNode } from '../plugin-runtime/PluginBlockNode'

// The M1 minimal node set: paragraph (built into `lexical` core, no
// registration needed), heading, todo (a single-item `check` list per block
// — see `serialization.ts`), and divider. Nothing else is registered, so
// paste/import of richer content degrades to plain paragraphs rather than
// silently producing node types the rest of the app (and `cobble-core`'s
// M1-supported block vocabulary) doesn't know about yet.
// `PluginBlockNode` (M4) is the one exception below M1's own vocabulary —
// it's the single generic decorator node that hosts every `plugin_block`
// (see `docs/ARCHITECTURE.md`'s "Plugin system" section).
export const EDITOR_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  ListNode,
  ListItemNode,
  HorizontalRuleNode,
  PluginBlockNode,
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
  list: {
    checklist: 'editor-checklist',
    listitem: 'editor-listitem',
    listitemChecked: 'editor-listitem--checked',
    listitemUnchecked: 'editor-listitem--unchecked',
  },
}

import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getNodeByKey,
  $isElementNode,
  ElementNode,
  type DOMConversionMap,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
  type Spread,
} from 'lexical'

// A hand-rolled collapsible ("toggle") block, following the shape of
// `cobble_core::Block { type: "toggle", content, children }` — one
// `ToggleContainerNode` per block, wrapping exactly two element children:
// a single-line `ToggleTitleNode` (mirrors `Block.content`, the summary
// text) and a `ToggleContentNode` holding the nested block tree (mirrors
// `Block.children`). `@lexical/rich-text`/`@lexical/code`'s own collapsible
// plugin doesn't ship as an installable package (it's playground-only
// example code), so this is hand-rolled rather than pulled in.
//
// `__open` isn't persisted to `Block.attrs.open` for round-tripping — it's
// UI-only state, reset to expanded on reload, same as Notion's own toggle
// blocks don't remember collapsed state across sessions either.

export type SerializedToggleContainerNode = Spread<{ open: boolean }, SerializedElementNode>

export class ToggleContainerNode extends ElementNode {
  __open: boolean

  constructor(open: boolean = true, key?: NodeKey) {
    super(key)
    this.__open = open
  }

  static getType(): string {
    return 'toggle-container'
  }

  static clone(node: ToggleContainerNode): ToggleContainerNode {
    return new ToggleContainerNode(node.__open, node.__key)
  }

  static importJSON(serializedNode: SerializedToggleContainerNode): ToggleContainerNode {
    return $createToggleContainerNode(serializedNode.open).updateFromJSON(serializedNode)
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedToggleContainerNode>): this {
    return super.updateFromJSON(serializedNode).setOpen(serializedNode.open)
  }

  exportJSON(): SerializedToggleContainerNode {
    return { ...super.exportJSON(), type: 'toggle-container', version: 1, open: this.__open }
  }

  static importDOM(): DOMConversionMap | null {
    return null
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const dom = document.createElement('div')
    dom.className = this.__open ? 'block-toggle' : 'block-toggle block-toggle--collapsed'

    const caret = document.createElement('button')
    caret.type = 'button'
    caret.className = 'block-toggle-caret'
    caret.contentEditable = 'false'
    caret.setAttribute('aria-label', 'Toggle')
    caret.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const key = this.getKey()
      editor.update(() => {
        const latest = $getNodeByKey(key)
        if ($isToggleContainerNode(latest)) latest.setOpen(!latest.getOpen())
      })
    })
    dom.appendChild(caret)

    return dom
  }

  updateDOM(prevNode: ToggleContainerNode, dom: HTMLElement): boolean {
    if (prevNode.__open !== this.__open) {
      dom.classList.toggle('block-toggle--collapsed', !this.__open)
    }
    return false
  }

  setOpen(open: boolean): this {
    const writable = this.getWritable()
    writable.__open = open
    return writable
  }

  getOpen(): boolean {
    return this.getLatest().__open
  }

  getTitleNode(): ToggleTitleNode | null {
    const first = this.getFirstChild()
    return $isToggleTitleNode(first) ? first : null
  }

  getContentNode(): ToggleContentNode | null {
    const second = this.getChildAtIndex(1)
    return $isToggleContentNode(second) ? second : null
  }

  canBeEmpty(): boolean {
    return false
  }

  isShadowRoot(): boolean {
    return true
  }
}

export function $createToggleContainerNode(open: boolean = true): ToggleContainerNode {
  return $applyNodeReplacement(new ToggleContainerNode(open))
}

export function $isToggleContainerNode(node: LexicalNode | null | undefined): node is ToggleContainerNode {
  return node instanceof ToggleContainerNode
}

// --- Title (summary line) ---------------------------------------------

export class ToggleTitleNode extends ElementNode {
  static getType(): string {
    return 'toggle-title'
  }

  static clone(node: ToggleTitleNode): ToggleTitleNode {
    return new ToggleTitleNode(node.__key)
  }

  static importJSON(serializedNode: SerializedElementNode): ToggleTitleNode {
    return $createToggleTitleNode().updateFromJSON(serializedNode)
  }

  exportJSON(): SerializedElementNode {
    return { ...super.exportJSON(), type: 'toggle-title', version: 1 }
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'block-toggle-title'
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  collapseAtStart(): boolean {
    return true
  }

  // Enter inside the summary line moves the caret into the content
  // region (creating its first paragraph if empty) instead of splitting
  // the title into two summary lines.
  insertNewAfter(_selection: RangeSelection): LexicalNode | null {
    const container = this.getParent()
    if (!$isToggleContainerNode(container)) return null
    let content = container.getContentNode()
    if (!content) {
      content = $createToggleContentNode()
      container.append(content)
    }
    let firstChild = content.getFirstChild()
    if (!firstChild) {
      firstChild = $createParagraphNode()
      content.append(firstChild)
    }
    if ($isElementNode(firstChild)) firstChild.selectStart()
    return null
  }
}

export function $createToggleTitleNode(): ToggleTitleNode {
  return $applyNodeReplacement(new ToggleTitleNode())
}

export function $isToggleTitleNode(node: LexicalNode | null | undefined): node is ToggleTitleNode {
  return node instanceof ToggleTitleNode
}

// --- Content (nested children) -----------------------------------------

export class ToggleContentNode extends ElementNode {
  static getType(): string {
    return 'toggle-content'
  }

  static clone(node: ToggleContentNode): ToggleContentNode {
    return new ToggleContentNode(node.__key)
  }

  static importJSON(serializedNode: SerializedElementNode): ToggleContentNode {
    return $createToggleContentNode().updateFromJSON(serializedNode)
  }

  exportJSON(): SerializedElementNode {
    return { ...super.exportJSON(), type: 'toggle-content', version: 1 }
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'block-toggle-content'
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  canBeEmpty(): boolean {
    return true
  }
}

export function $createToggleContentNode(): ToggleContentNode {
  return $applyNodeReplacement(new ToggleContentNode())
}

export function $isToggleContentNode(node: LexicalNode | null | undefined): node is ToggleContentNode {
  return node instanceof ToggleContentNode
}

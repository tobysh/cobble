import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical'
import { FileText } from 'lucide-react'
import type { ReactElement } from 'react'
import { useWorkspace } from '../../state/store'
import type { PageId } from '../../state/types'

// Sub-page reference block — matches `cobble_core::Block { type: "sub_page",
// attrs: { page_id } }`. Stores a stable `PageId` (never a position — "block
// IDs are forever" per CLAUDE.md applies just as much to the pages this
// links to), and renders as a clickable pill that navigates into that page.
// The page itself is a normal page in the tree (created via `createPage` at
// insertion time in `PageView.tsx`); this block is only the in-content
// reference to it, same as clicking it in the sidebar.

export type SerializedSubPageBlockNode = Spread<{ pageId: PageId }, SerializedLexicalNode>

export class SubPageBlockNode extends DecoratorNode<ReactElement> {
  __pageId: PageId

  constructor(pageId: PageId, key?: NodeKey) {
    super(key)
    this.__pageId = pageId
  }

  static getType(): string {
    return 'sub-page-block'
  }

  static clone(node: SubPageBlockNode): SubPageBlockNode {
    return new SubPageBlockNode(node.__pageId, node.__key)
  }

  static importJSON(serializedNode: SerializedSubPageBlockNode): SubPageBlockNode {
    return $createSubPageBlockNode(serializedNode.pageId)
  }

  exportJSON(): SerializedSubPageBlockNode {
    return { ...super.exportJSON(), type: 'sub-page-block', version: 1, pageId: this.__pageId }
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'block-subpage-host'
    return div
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return false
  }

  getPageId(): PageId {
    return this.getLatest().__pageId
  }

  decorate(): ReactElement {
    return <SubPageBlockComponent pageId={this.__pageId} />
  }
}

export function $createSubPageBlockNode(pageId: PageId): SubPageBlockNode {
  return new SubPageBlockNode(pageId)
}

export function $isSubPageBlockNode(node: LexicalNode | null | undefined): node is SubPageBlockNode {
  return node instanceof SubPageBlockNode
}

function SubPageBlockComponent({ pageId }: { pageId: PageId }) {
  const page = useWorkspace((s) => s.pages[pageId])
  const openPage = useWorkspace((s) => s.openPage)

  return (
    <button
      type="button"
      className="block-subpage"
      contentEditable={false}
      onClick={() => openPage(pageId)}
    >
      <span className="block-subpage-icon">{page?.icon ?? <FileText size={15} />}</span>
      <span className="block-subpage-title">{page?.title || 'Untitled'}</span>
    </button>
  )
}

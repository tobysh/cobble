import { Plus } from 'lucide-react'
import { useWorkspace } from '../state/store'
import { Block } from './Block'
import { EditableText } from './EditableText'
import './editor.css'

export function PageView({ pageId }: { pageId: string }) {
  const page = useWorkspace((s) => s.pages[pageId])
  const updatePageTitle = useWorkspace((s) => s.updatePageTitle)
  const insertBlockAfter = useWorkspace((s) => s.insertBlockAfter)

  if (!page) {
    return <div className="page-view page-view--missing">Page not found.</div>
  }

  const lastIndex = page.blocks.length - 1

  return (
    <div className="page-view">
      <div className="page-header">
        <div className="page-icon">{page.icon}</div>
        <EditableText
          value={page.title}
          onChange={(text) => updatePageTitle(pageId, text)}
          className="page-title"
        />
      </div>

      <div className="page-blocks">
        {page.blocks.map((block, i) => (
          <Block key={block.id} pageId={pageId} block={block} path={[i]} />
        ))}

        <button
          type="button"
          className="page-add-block"
          onClick={() => insertBlockAfter(pageId, [lastIndex], 'paragraph')}
        >
          <Plus size={13} />
          <span>Add a block</span>
        </button>
      </div>
    </div>
  )
}

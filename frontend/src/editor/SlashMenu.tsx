import { AnimatePresence, motion } from 'framer-motion'
import { CheckSquare, ChevronRight, Code, FileText, Heading1, Image as ImageIcon, Minus, Quote, Table, Text } from 'lucide-react'
import { dropdownVariants, listItemVariants } from '../theme/motion'
import type { BlockType } from '../state/types'
import './editor.css'

// The full M2 block vocabulary `cobble-core` reserves (see `BlockType` in
// `state/types.ts`) — everything here now has a matching entry in
// `editor/nodes.ts`/`editor/serialization.ts` (only `plugin_block`, a
// separate in-flight task with its own insertion path, is left out).
const OPTIONS: { type: BlockType; label: string; hint: string; icon: typeof Text }[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain paragraph', icon: Text },
  { type: 'heading', label: 'Heading', hint: 'Section heading', icon: Heading1 },
  { type: 'todo', label: 'To-do', hint: 'Checkbox list item', icon: CheckSquare },
  { type: 'toggle', label: 'Toggle', hint: 'Collapsible content', icon: ChevronRight },
  { type: 'quote', label: 'Quote', hint: 'Block quotation', icon: Quote },
  { type: 'code', label: 'Code', hint: 'Code block', icon: Code },
  { type: 'divider', label: 'Divider', hint: 'Horizontal rule', icon: Minus },
  { type: 'image', label: 'Image', hint: 'Upload or embed by URL', icon: ImageIcon },
  { type: 'table', label: 'Table', hint: 'Basic grid', icon: Table },
  { type: 'sub_page', label: 'Sub-page', hint: 'Create a nested page', icon: FileText },
]

export function SlashMenu({
  open,
  query,
  onSelect,
  onClose,
}: {
  open: boolean
  query: string
  onSelect: (type: BlockType) => void
  onClose: () => void
}) {
  const filtered = OPTIONS.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="slash-menu"
          variants={dropdownVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onMouseLeave={onClose}
        >
          {filtered.length === 0 && <div className="slash-menu-empty">No matching blocks</div>}
          {filtered.map(({ type, label, hint, icon: Icon }, i) => (
            <motion.button
              key={type}
              type="button"
              className="slash-menu-item"
              custom={i}
              variants={listItemVariants}
              initial="hidden"
              animate="visible"
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(type)
              }}
            >
              <span className="slash-menu-icon">
                <Icon size={15} />
              </span>
              <span className="slash-menu-text">
                <span className="slash-menu-label">{label}</span>
                <span className="slash-menu-hint">{hint}</span>
              </span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

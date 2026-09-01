import { AnimatePresence, motion } from 'framer-motion'
import { CheckSquare, Heading1, Minus, Text } from 'lucide-react'
import { dropdownVariants, listItemVariants } from '../theme/motion'
import type { BlockType } from '../state/types'
import './editor.css'

// The M1 minimal node set only — paragraph/heading/todo/divider (see the
// comment on `EDITOR_NODES` in `editor/nodes.ts`). The richer block
// vocabulary `cobble-core` already reserves (toggle/quote/code/table/image/
// sub_page) isn't wired into the Lexical editor yet — that's M2 per the
// roadmap page in the workspace itself — so it's left out of this menu
// rather than offered and silently downgraded to a paragraph on save.
const OPTIONS: { type: BlockType; label: string; hint: string; icon: typeof Text }[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain paragraph', icon: Text },
  { type: 'heading', label: 'Heading', hint: 'Section heading', icon: Heading1 },
  { type: 'todo', label: 'To-do', hint: 'Checkbox list item', icon: CheckSquare },
  { type: 'divider', label: 'Divider', hint: 'Horizontal rule', icon: Minus },
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

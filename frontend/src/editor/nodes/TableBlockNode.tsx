import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical'
import { Plus, Trash2 } from 'lucide-react'
import { type ReactElement } from 'react'

// Minimal table block — matches `cobble_core::Block { type: "table", attrs:
// { rows: string[][] } }`. Per the task brief this is intentionally a basic
// grid, not `@lexical/table`'s full spreadsheet-like cell-selection/merge
// machinery — `docs/ARCHITECTURE.md` only asks for a `DecoratorNode` here,
// so each cell is a plain editable div and the node just holds a 2D array of
// strings.

export type SerializedTableBlockNode = Spread<{ rows: string[][] }, SerializedLexicalNode>

function defaultRows(): string[][] {
  return [
    ['', ''],
    ['', ''],
  ]
}

export class TableBlockNode extends DecoratorNode<ReactElement> {
  __rows: string[][]

  constructor(rows?: string[][], key?: NodeKey) {
    super(key)
    this.__rows = rows && rows.length > 0 ? rows.map((row) => [...row]) : defaultRows()
  }

  static getType(): string {
    return 'table-block'
  }

  static clone(node: TableBlockNode): TableBlockNode {
    return new TableBlockNode(node.__rows, node.__key)
  }

  static importJSON(serializedNode: SerializedTableBlockNode): TableBlockNode {
    return $createTableBlockNode(serializedNode.rows)
  }

  exportJSON(): SerializedTableBlockNode {
    return { ...super.exportJSON(), type: 'table-block', version: 1, rows: this.__rows.map((row) => [...row]) }
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'block-table-host'
    return div
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return false
  }

  getRows(): string[][] {
    return this.getLatest().__rows
  }

  setCell(row: number, col: number, text: string): this {
    const writable = this.getWritable()
    const rows = writable.__rows.map((r) => [...r])
    rows[row][col] = text
    writable.__rows = rows
    return writable
  }

  addRow(): this {
    const writable = this.getWritable()
    const cols = writable.__rows[0]?.length ?? 2
    writable.__rows = [...writable.__rows.map((r) => [...r]), new Array(cols).fill('')]
    return writable
  }

  addColumn(): this {
    const writable = this.getWritable()
    writable.__rows = writable.__rows.map((r) => [...r, ''])
    return writable
  }

  removeRow(index: number): this {
    const writable = this.getWritable()
    if (writable.__rows.length <= 1) return writable
    writable.__rows = writable.__rows.filter((_, i) => i !== index).map((r) => [...r])
    return writable
  }

  removeColumn(index: number): this {
    const writable = this.getWritable()
    if ((writable.__rows[0]?.length ?? 0) <= 1) return writable
    writable.__rows = writable.__rows.map((r) => r.filter((_, i) => i !== index))
    return writable
  }

  decorate(): ReactElement {
    return <TableBlockComponent nodeKey={this.getKey()} rows={this.__rows} />
  }
}

export function $createTableBlockNode(rows?: string[][]): TableBlockNode {
  return new TableBlockNode(rows)
}

export function $isTableBlockNode(node: LexicalNode | null | undefined): node is TableBlockNode {
  return node instanceof TableBlockNode
}

function TableBlockComponent({ nodeKey, rows }: { nodeKey: NodeKey; rows: string[][] }) {
  const [editor] = useLexicalComposerContext()

  const withNode = (fn: (node: TableBlockNode) => void) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isTableBlockNode(node)) fn(node)
    })
  }

  return (
    <div className="block-table" contentEditable={false}>
      <table className="block-table-grid">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <div
                    className="block-table-cell"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => withNode((node) => node.setCell(r, c, e.currentTarget.textContent ?? ''))}
                  >
                    {cell}
                  </div>
                </td>
              ))}
              <td className="block-table-row-actions">
                <button
                  type="button"
                  title="Remove row"
                  onClick={() => withNode((node) => node.removeRow(r))}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
          <tr className="block-table-col-actions">
            {rows[0]?.map((_, c) => (
              <td key={c}>
                <button type="button" title="Remove column" onClick={() => withNode((node) => node.removeColumn(c))}>
                  <Trash2 size={12} />
                </button>
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
      <div className="block-table-add-row">
        <button type="button" onClick={() => withNode((node) => node.addRow())}>
          <Plus size={12} /> Row
        </button>
        <button type="button" onClick={() => withNode((node) => node.addColumn())}>
          <Plus size={12} /> Column
        </button>
      </div>
    </div>
  )
}

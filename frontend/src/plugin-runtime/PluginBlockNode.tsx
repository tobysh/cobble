import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import { PluginBlockView } from './PluginBlockView'

export type SerializedPluginBlockNode = Spread<
  {
    pluginId: string
    blockType: string
    data: unknown
  },
  SerializedLexicalNode
>

/**
 * `PluginBlockNode` — the single generic Lexical `DecoratorNode` that hosts
 * every `plugin_block` (per `docs/ARCHITECTURE.md`'s "Plugin system" section:
 * "A single generic `PluginBlockNode` ... hosts all plugin blocks,
 * differentiated at the render layer by plugin registry lookup"). It carries
 * exactly the on-disk `plugin_block` attrs shape
 * (`{plugin_id, block_type, data}`, `crates/cobble-core/src/block.rs`) and
 * nothing else — no plugin-supplied styling, color, or markup ever reaches
 * this node or its React output (`PluginBlockView`); only
 * `UiSchemaRenderer`'s fixed, theme-token-backed widget vocabulary does (see
 * `ui-schema.ts`/`.css`).
 */
export class PluginBlockNode extends DecoratorNode<React.ReactNode> {
  __pluginId: string
  __blockType: string
  __data: unknown

  static getType(): string {
    return 'plugin-block'
  }

  static clone(node: PluginBlockNode): PluginBlockNode {
    return new PluginBlockNode(node.__pluginId, node.__blockType, node.__data, node.__key)
  }

  static importJSON(serializedNode: SerializedPluginBlockNode): PluginBlockNode {
    return $createPluginBlockNode(serializedNode.pluginId, serializedNode.blockType, serializedNode.data)
  }

  constructor(pluginId: string, blockType: string, data: unknown, key?: NodeKey) {
    super(key)
    this.__pluginId = pluginId
    this.__blockType = blockType
    this.__data = data
  }

  exportJSON(): SerializedPluginBlockNode {
    return {
      pluginId: this.__pluginId,
      blockType: this.__blockType,
      data: this.__data,
      type: PluginBlockNode.getType(),
      version: 1,
    }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.className = 'plugin-block-host'
    div.contentEditable = 'false'
    return div
  }

  updateDOM(): false {
    // Nothing about the wrapper element itself needs to change on update —
    // pluginId/blockType/data changes are handled by React re-rendering
    // `decorate()`'s output, not by touching the host `div`.
    return false
  }

  isInline(): boolean {
    return false
  }

  getPluginId(): string {
    return this.__pluginId
  }

  getBlockType(): string {
    return this.__blockType
  }

  getData(): unknown {
    return this.__data
  }

  setData(data: unknown): void {
    const writable = this.getWritable()
    writable.__data = data
  }

  decorate(): React.ReactNode {
    return <PluginBlockView pluginId={this.__pluginId} blockType={this.__blockType} data={this.__data} />
  }
}

export function $createPluginBlockNode(pluginId: string, blockType: string, data: unknown): PluginBlockNode {
  return new PluginBlockNode(pluginId, blockType, data)
}

export function $isPluginBlockNode(node: LexicalNode | null | undefined): node is PluginBlockNode {
  return node instanceof PluginBlockNode
}

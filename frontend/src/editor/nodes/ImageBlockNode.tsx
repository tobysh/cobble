import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical'
import { ImageIcon } from 'lucide-react'
import { useState, type ReactElement } from 'react'

// Image block — matches `cobble_core::Block { type: "image", attrs: {src,
// alt} }` per `docs/ARCHITECTURE.md`'s content model (`DecoratorNode` handles
// image/table/sub-page blocks). `src` is either a remote URL or a `data:`
// URI (pasted-in files are read to a data URL rather than copied into the
// workspace's file tree — there's no asset-storage story yet, see M2 notes).

export type SerializedImageBlockNode = Spread<{ src: string; alt: string }, SerializedLexicalNode>

export class ImageBlockNode extends DecoratorNode<ReactElement> {
  __src: string
  __alt: string

  constructor(src: string = '', alt: string = '', key?: NodeKey) {
    super(key)
    this.__src = src
    this.__alt = alt
  }

  static getType(): string {
    return 'image-block'
  }

  static clone(node: ImageBlockNode): ImageBlockNode {
    return new ImageBlockNode(node.__src, node.__alt, node.__key)
  }

  static importJSON(serializedNode: SerializedImageBlockNode): ImageBlockNode {
    return $createImageBlockNode(serializedNode.src, serializedNode.alt)
  }

  exportJSON(): SerializedImageBlockNode {
    return { ...super.exportJSON(), type: 'image-block', version: 1, src: this.__src, alt: this.__alt }
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'block-image-host'
    return div
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return false
  }

  getSrc(): string {
    return this.getLatest().__src
  }

  getAlt(): string {
    return this.getLatest().__alt
  }

  setSrc(src: string): this {
    const writable = this.getWritable()
    writable.__src = src
    return writable
  }

  setAlt(alt: string): this {
    const writable = this.getWritable()
    writable.__alt = alt
    return writable
  }

  decorate(): ReactElement {
    return <ImageBlockComponent nodeKey={this.getKey()} src={this.__src} alt={this.__alt} />
  }
}

export function $createImageBlockNode(src: string = '', alt: string = ''): ImageBlockNode {
  return new ImageBlockNode(src, alt)
}

export function $isImageBlockNode(node: LexicalNode | null | undefined): node is ImageBlockNode {
  return node instanceof ImageBlockNode
}

function ImageBlockComponent({ nodeKey, src, alt }: { nodeKey: NodeKey; src: string; alt: string }) {
  const [editor] = useLexicalComposerContext()
  const [urlDraft, setUrlDraft] = useState('')

  const setSrc = (next: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isImageBlockNode(node)) node.setSrc(next)
    })
  }

  const setAlt = (next: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isImageBlockNode(node)) node.setAlt(next)
    })
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setSrc(reader.result)
    }
    reader.readAsDataURL(file)
  }

  if (!src) {
    return (
      <div className="block-image block-image--empty" contentEditable={false}>
        <div className="block-image-icon">
          <ImageIcon size={20} />
        </div>
        <div className="block-image-controls">
          <input
            type="text"
            className="block-image-url-input"
            placeholder="Paste an image URL and press Enter…"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && urlDraft.trim()) setSrc(urlDraft.trim())
            }}
          />
          <label className="block-image-upload">
            Upload
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFile(file)
              }}
            />
          </label>
        </div>
      </div>
    )
  }

  return (
    <figure className="block-image" contentEditable={false}>
      <img className="block-image-img" src={src} alt={alt} />
      <input
        className="block-image-caption"
        type="text"
        placeholder="Add a caption…"
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
      />
    </figure>
  )
}

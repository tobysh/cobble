import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { UiSchemaRenderer } from './UiSchemaRenderer'
import './plugin-block.css'

// The Tauri command a real plugin-execution round trip would call to get a
// block's rendered UI schema (host loads the plugin via `cobble-plugin-host`,
// calls its `render-block` export — see `docs/PLUGINS.md`'s "Status: what's
// real today"). As of this writing `src-tauri/src/commands/` only exposes
// the page commands (`commands::pages::*`, wired in `src-tauri/src/lib.rs`'s
// `invoke_handler!`) — nothing calls into `cobble-plugin-host` from Tauri
// yet, so this command doesn't exist and `invoke` below always rejects.
// `PluginBlockView` degrades to a placeholder in that case rather than
// erroring, so this file is written against the *eventual* contract: once a
// real command is wired up, nothing here needs to change.
const RENDER_PLUGIN_BLOCK_COMMAND = 'render_plugin_block'

/** Data crossing the WIT boundary as `{plugin_id, block_type, data}` (see `docs/ARCHITECTURE.md#file-format--storage`). */
interface PluginBlockRenderRequest extends Record<string, unknown> {
  pluginId: string
  blockType: string
  dataJson: string
}

/**
 * Placeholder UI-schema doc rendered while a plugin's real output is
 * unavailable — loading, no host command wired yet, or the host call
 * failed/was denied. Goes through `UiSchemaRenderer` like any other schema
 * so it's still theme-token-only, never a raw string dropped into the DOM.
 */
function placeholderSchema(pluginId: string, blockType: string, reason: string) {
  return {
    widget: 'text' as const,
    value: `Plugin "${pluginId}" block (${blockType}): ${reason}`,
    tone: 'tertiary' as const,
  }
}

/** The React content a `PluginBlockNode` decorates itself with. */
export function PluginBlockView({
  pluginId,
  blockType,
  data,
}: {
  pluginId: string
  blockType: string
  data: unknown
}) {
  // Lazy initial value only — deliberately not reset to a "loading…"
  // placeholder synchronously inside the effect below (that would be a
  // same-render setState-in-effect antipattern for no real benefit here):
  // the previous render's content staying on screen until the new fetch
  // settles is the right degrade given today's `invoke` call always
  // rejects anyway (see the module doc comment above).
  const [schema, setSchema] = useState<unknown>(() => placeholderSchema(pluginId, blockType, 'loading…'))

  useEffect(() => {
    let cancelled = false

    const request: PluginBlockRenderRequest = {
      pluginId,
      blockType,
      dataJson: JSON.stringify(data ?? null),
    }

    invoke<string>(RENDER_PLUGIN_BLOCK_COMMAND, request)
      .then((json) => {
        if (cancelled) return
        try {
          setSchema(JSON.parse(json))
        } catch {
          setSchema(placeholderSchema(pluginId, blockType, 'returned a malformed UI schema'))
        }
      })
      .catch(() => {
        // Expected today (see the module doc comment above): no host command
        // is wired up yet, so this always lands here. Degrade instead of
        // surfacing an error boundary or leaving a blank block.
        if (!cancelled) setSchema(placeholderSchema(pluginId, blockType, 'rendering isn’t wired up yet'))
      })

    return () => {
      cancelled = true
    }
  }, [pluginId, blockType, data])

  return (
    <div className="plugin-block" contentEditable={false}>
      <div className="plugin-block-label">{pluginId}</div>
      <div className="plugin-block-body">
        <UiSchemaRenderer schema={schema} />
      </div>
    </div>
  )
}

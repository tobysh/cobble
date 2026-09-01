import { useEffect, useRef, useState } from 'react'
import { api } from '../state/api'
import { usePluginTrust } from '../state/pluginTrust'
import { CustomUiConsentPrompt } from './CustomUiConsentPrompt'
import './custom-ui.css'

// The `custom_ui` sandboxed-iframe escape hatch — see `docs/ARCHITECTURE.md`
// ("Plugin system" > "Escape hatch"): "`permissions.custom_ui = true` allows
// a sandboxed `<iframe sandbox="allow-scripts">` with postMessage comms and
// injected theme CSS variables — flagged to the user at install as visually
// unverified." This is a materially bigger trust boundary than
// `UiSchemaRenderer` (arbitrary plugin script execution vs. a closed widget
// vocabulary), so every render path here is deny-by-default twice over:
//   1. The manifest grant, re-verified host-side on every mount/change via
//      `api.checkCustomUiPermission` (never trusted from a prop or cached
//      client state) — see `src-tauri/src/commands/plugins.rs`.
//   2. The user's own consent, persisted per-plugin in `state/pluginTrust.ts`
//      and invalidated whenever the manifest text changes.
// Both must say yes before the iframe ever mounts.

/**
 * Sandbox flags: `allow-scripts` ONLY.
 *
 * Deliberately NOT `allow-same-origin`. A sandboxed iframe with neither flag
 * gets an opaque ("null") origin and cannot run scripts at all; adding
 * `allow-scripts` alone lets it run script but keeps that opaque origin, so
 * it still can't read/write this document's DOM, cookies, or storage, can't
 * make same-origin-authenticated requests as the app, and (via `srcdoc`
 * with no matching real origin) has no persistent storage of its own either.
 * Adding `allow-same-origin` on top of `allow-scripts` is the one
 * combination that defeats the sandbox: per the HTML spec, when both are
 * present on a `srcdoc` frame the browser grants it the *embedding
 * document's own origin* instead of a fresh opaque one — so plugin script
 * would then run WITH scripting enabled AND with same-origin standing to
 * read this document's storage/cookies and any other same-origin resource,
 * which is exactly the isolation this feature exists to provide. Do not add
 * it "to make postMessage work" — postMessage does not require it (see
 * `handleMessage` below, which verifies the sender by identity rather than
 * by origin string, since an opaque-origin sender has no usable origin
 * string to check anyway).
 */
const SANDBOX_FLAGS = 'allow-scripts'

// Curated allowlist of semantic tokens exposed to plugin custom UI. Plugins
// never get the app's real stylesheet or DOM — just these resolved values,
// injected as a `:root` block into their own document — so they can be
// theme-aware without ever being handed (or able to specify) a raw color,
// matching CLAUDE.md's "Theme tokens only" rule as closely as an arbitrary-
// HTML surface can (the plugin's own markup can still hardcode colors; nothing
// here can stop that, hence the architecture doc flagging this whole path as
// "visually unverified").
const EXPOSED_THEME_TOKENS = [
  '--bg-canvas',
  '--bg-surface',
  '--bg-surface-hover',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-on-accent',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--danger',
  '--danger-soft',
  '--border-hairline',
  '--border-strong',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--font-sans',
  '--font-mono',
]

function buildThemeStyleBlock(): string {
  const computed = getComputedStyle(document.documentElement)
  const declarations = EXPOSED_THEME_TOKENS.map((token) => {
    const value = computed.getPropertyValue(token).trim()
    return value ? `${token}: ${value};` : null
  }).filter((d): d is string => d !== null)

  return `:root { ${declarations.join(' ')} }
body { margin: 0; background: var(--bg-canvas); color: var(--text-primary); font-family: var(--font-sans); }`
}

/**
 * Network access is otherwise unrestricted inside a sandboxed iframe (the
 * `sandbox` attribute governs navigation/popups/forms/etc., not fetch/XHR/
 * WebSocket), so the manifest's `[permissions].network` allowlist is
 * enforced here instead, via a CSP `connect-src` injected into the plugin's
 * own document. An empty/absent allowlist means no network access at all
 * ("'none'"), not "same as the host app" — fail closed.
 */
function buildContentSecurityPolicy(networkAllowlist: string[] | undefined): string {
  const connectSrc = networkAllowlist && networkAllowlist.length > 0 ? networkAllowlist.join(' ') : "'none'"
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    `connect-src ${connectSrc}`,
  ].join('; ')
}

function buildSrcDoc(body: string, networkAllowlist: string[] | undefined): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(networkAllowlist)}">
<style>${buildThemeStyleBlock()}</style>
</head>
<body>${body}</body>
</html>`
}

type ManifestGate =
  | { status: 'checking' }
  | { status: 'error'; message: string }
  | { status: 'not-granted' }
  | { status: 'granted' }

interface ManifestGateResult {
  manifestToml: string
  status: 'error' | 'not-granted' | 'granted'
  message?: string
}

/**
 * The host-side half of the gate. Re-runs on every `manifestToml` change (a
 * plugin update, or a caller re-reading the manifest from disk) and never
 * trusts a previous "granted" verdict once the text it was computed from is
 * stale — the "checking" status is derived during render by comparing the
 * last completed result's manifest text against the current one, rather
 * than reset imperatively at the top of the effect, so there's exactly one
 * `setState` call in this hook (the async completion), not two.
 */
function useManifestGate(manifestToml: string): ManifestGate {
  const [result, setResult] = useState<ManifestGateResult | null>(null)

  useEffect(() => {
    let cancelled = false
    api.checkCustomUiPermission(manifestToml).then(
      (granted) => {
        if (!cancelled) {
          setResult({ manifestToml, status: granted ? 'granted' : 'not-granted' })
        }
      },
      (err: unknown) => {
        if (!cancelled) setResult({ manifestToml, status: 'error', message: String(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [manifestToml])

  if (!result || result.manifestToml !== manifestToml) return { status: 'checking' }
  if (result.status === 'error') return { status: 'error', message: result.message ?? 'unknown error' }
  if (result.status === 'not-granted') return { status: 'not-granted' }
  return { status: 'granted' }
}

export interface CustomUiFrameProps {
  pluginId: string
  pluginName: string
  /** Raw `plugin.toml` text for this plugin — re-verified host-side on every mount/change, never trusted as-is. */
  manifestToml: string
  /**
   * The plugin's custom-UI markup: HTML (and any inline `<script>` a plugin
   * needs) meant to be the *contents* of a document, not a full standalone
   * `<html>` document — `CustomUiFrame` supplies the surrounding envelope
   * (doctype, CSP, injected theme tokens) so every plugin gets the same
   * locked-down wrapper regardless of what it ships.
   */
  body: string
  /** Hosts this plugin may reach from its custom UI, from `[permissions].network` in its manifest. Omit/empty = no network access. */
  networkAllowlist?: string[]
  /** Called with whatever the plugin's script posts via `window.parent.postMessage(data, '*')`. */
  onMessage?: (data: unknown) => void
  title?: string
}

/**
 * Renders a plugin's custom UI inside a sandboxed iframe once both the
 * manifest grant and user consent are confirmed — see the module doc
 * comment above for the two-gate design and `SANDBOX_FLAGS` for why the
 * sandbox attribute is exactly `"allow-scripts"` and nothing more.
 */
export function CustomUiFrame({
  pluginId,
  pluginName,
  manifestToml,
  body,
  networkAllowlist,
  onMessage,
  title,
}: CustomUiFrameProps) {
  const gate = useManifestGate(manifestToml)
  const decision = usePluginTrust((s) => s.getDecision(pluginId, manifestToml))
  const decide = usePluginTrust((s) => s.decide)
  const [reconsidering, setReconsidering] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Verifies the sender by identity (the exact `contentWindow` this
  // component's own iframe holds), not by `event.origin` — a sandboxed
  // frame without `allow-same-origin` has no stable, checkable origin
  // string (it reports `"null"`), so identity is the only reliable check
  // available, and it's a strictly stronger one: nothing other than this
  // exact iframe instance can ever be `=== iframeRef.current?.contentWindow`.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      onMessage?.(event.data)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onMessage])

  if (gate.status === 'checking') return null

  if (gate.status === 'error') {
    console.error(`custom_ui permission check failed for plugin "${pluginId}":`, gate.message)
    return null
  }

  // The manifest itself never declared `custom_ui` — nothing to consent to
  // and nothing to render, no matter what the caller passed in `body`. A
  // caller reaching this state is a bug upstream (it should not have tried
  // to mount `CustomUiFrame` for this plugin at all), not something to
  // surface to the user.
  if (gate.status === 'not-granted') return null

  if (decision === 'undecided' || reconsidering) {
    return (
      <CustomUiConsentPrompt
        pluginId={pluginId}
        pluginName={pluginName}
        onAllow={() => {
          decide(pluginId, 'allowed', manifestToml)
          setReconsidering(false)
        }}
        onDeny={() => {
          decide(pluginId, 'denied', manifestToml)
          setReconsidering(false)
        }}
      />
    )
  }

  if (decision === 'denied') {
    return (
      <div className="custom-ui-blocked">
        <p className="custom-ui-blocked-text">
          You denied &ldquo;{pluginName}&rdquo; permission to run its custom interface.
        </p>
        <button type="button" className="custom-ui-blocked-button" onClick={() => setReconsidering(true)}>
          Reconsider
        </button>
      </div>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      className="custom-ui-frame"
      title={title ?? `${pluginName} custom UI`}
      sandbox={SANDBOX_FLAGS}
      referrerPolicy="no-referrer"
      srcDoc={buildSrcDoc(body, networkAllowlist)}
    />
  )
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Per-plugin user consent for the `custom_ui` sandboxed-iframe escape hatch
// (see `plugin-runtime/CustomUiFrame.tsx` and `docs/ARCHITECTURE.md`'s
// "Escape hatch" paragraph). Deliberately a separate persisted store from
// `useWorkspace` (`state/store.ts`) rather than a field on it:
//  - `useWorkspace` holds workspace content/UI-session state that is either
//    backed by the on-disk workspace (CLAUDE.md: "files are truth") or is
//    fine to lose on reload (open page, palette-open, etc.).
//  - A security consent decision is neither — it isn't workspace content
//    (it doesn't belong in a `.cobble.json` page file), but it also must
//    *not* evaporate on every reload the way `useWorkspace`'s in-memory
//    fields do, or the user would be re-prompted every launch. So this store
//    is the one piece of frontend state that's `persist`-backed
//    (localStorage), scoped narrowly to just this one decision.
//
// This is a trust decision the *user* makes about a *plugin*, independent of
// what the plugin's manifest declares — CustomUiFrame checks both: the
// backend-verified manifest grant (`api.checkCustomUiPermission`, which a
// user can't override) AND this stored consent (which the manifest can't
// grant on the user's behalf).

export type CustomUiDecision = 'allowed' | 'denied'

interface StoredConsent {
  decision: CustomUiDecision
  /**
   * The exact `plugin.toml` text the user was shown when they decided.
   * Compared verbatim against the plugin's *current* manifest text before
   * ever reusing a stored decision — any change to the manifest (a
   * newly-added permission, a version bump, anything) invalidates it and
   * `CustomUiFrame` re-prompts, per this task's "or on manifest/permission
   * changes" requirement. Using the raw text (rather than trying to hash or
   * selectively diff just the `[permissions]` table) means the frontend
   * needs no TOML parser of its own and can't be fooled by a change the
   * frontend didn't know to look at.
   */
  manifestToml: string
}

interface PluginTrustState {
  consent: Record<string, StoredConsent>
  /** Records the user's Allow/Deny choice for `pluginId` against the manifest text they saw. */
  decide: (pluginId: string, decision: CustomUiDecision, manifestToml: string) => void
  /**
   * `'undecided'` if there's no stored choice, or the stored choice was made
   * against a different manifest than `manifestToml` (see `manifestToml`'s
   * doc comment above) — both cases mean CustomUiFrame must show the
   * consent prompt again rather than trusting a stale decision.
   */
  getDecision: (pluginId: string, manifestToml: string) => CustomUiDecision | 'undecided'
  /** Clears a stored decision so the next render re-prompts — used by the "change" affordance on a blocked plugin. */
  clear: (pluginId: string) => void
}

export const usePluginTrust = create<PluginTrustState>()(
  persist(
    (set, get) => ({
      consent: {},

      decide: (pluginId, decision, manifestToml) =>
        set((s) => ({
          consent: { ...s.consent, [pluginId]: { decision, manifestToml } },
        })),

      getDecision: (pluginId, manifestToml) => {
        const stored = get().consent[pluginId]
        if (!stored || stored.manifestToml !== manifestToml) return 'undecided'
        return stored.decision
      },

      clear: (pluginId) =>
        set((s) => {
          const next = { ...s.consent }
          delete next[pluginId]
          return { consent: next }
        }),
    }),
    { name: 'cobble.plugin-custom-ui-trust' },
  ),
)

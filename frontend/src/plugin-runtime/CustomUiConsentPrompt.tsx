import { AnimatePresence, motion } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'
import { dropdownVariants, overlayVariants } from '../theme/motion'
import './custom-ui.css'

export interface CustomUiConsentPromptProps {
  pluginId: string
  pluginName: string
  onAllow: () => void
  onDeny: () => void
}

/**
 * The load-bearing consent gate for the `custom_ui` escape hatch (see
 * `docs/ARCHITECTURE.md`'s "Escape hatch" paragraph: "flagged to the user
 * at install as visually unverified"). Shown before a plugin's custom UI
 * iframe is allowed to render for the first time, and again whenever the
 * plugin's manifest text changes (`state/pluginTrust.ts` invalidates the
 * stored decision in that case) — never skippable, no default action wired
 * to Enter/Escape, because a user should not be able to dismiss this
 * without making an explicit choice.
 *
 * This is deliberately plain and blunt rather than glossy: the wording says
 * exactly what capability is being granted (arbitrary script execution in
 * the workspace, not just "custom UI"), because softening it would defeat
 * the point of asking at all.
 */
export function CustomUiConsentPrompt({ pluginId, pluginName, onAllow, onDeny }: CustomUiConsentPromptProps) {
  return (
    <AnimatePresence>
      <motion.div
        className="custom-ui-consent-overlay"
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="presentation"
      >
        <motion.div
          className="custom-ui-consent-panel"
          variants={dropdownVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`custom-ui-consent-title-${pluginId}`}
          aria-describedby={`custom-ui-consent-body-${pluginId}`}
        >
          <div className="custom-ui-consent-icon">
            <ShieldAlert size={20} />
          </div>
          <h2 id={`custom-ui-consent-title-${pluginId}`} className="custom-ui-consent-title">
            Let &ldquo;{pluginName}&rdquo; run its own custom interface?
          </h2>
          <p id={`custom-ui-consent-body-${pluginId}`} className="custom-ui-consent-body">
            This plugin wants to render its own HTML and JavaScript directly, instead of using Cobble&rsquo;s
            built-in components. That code runs in a locked-down frame with scripting enabled but no access to your
            files, your other data, or the rest of the app — but its appearance and behavior are not reviewed by
            Cobble, so treat it the way you would an embedded widget from any other source.
          </p>
          <p className="custom-ui-consent-plugin-id">Plugin id: {pluginId}</p>
          <div className="custom-ui-consent-actions">
            <button type="button" className="custom-ui-consent-button custom-ui-consent-button--deny" onClick={onDeny}>
              Deny
            </button>
            <button
              type="button"
              className="custom-ui-consent-button custom-ui-consent-button--allow"
              onClick={onAllow}
            >
              Allow custom interface
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

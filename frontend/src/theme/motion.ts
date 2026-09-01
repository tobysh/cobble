// Shared Framer Motion presets. Reused by every animated surface (command
// palette, slash menu, popovers, hover states) so the app has one motion
// language instead of ad hoc per-component tuning. See docs/ARCHITECTURE.md
// "Motion & visual design".

export const springPop = {
  type: 'spring' as const,
  stiffness: 340,
  damping: 30,
  mass: 0.8,
}

export const dropdownVariants = {
  hidden: { opacity: 0, scale: 0.96, y: -6, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: springPop,
  },
  // A slower, blur-forward dissolve rather than a snappy pop — reads as
  // "melting away" (e.g. the slash menu closing on backspace) rather than
  // a mirror of the entrance.
  exit: {
    opacity: 0,
    scale: 0.99,
    y: -2,
    filter: 'blur(6px)',
    transition: { duration: 0.22, ease: 'easeOut' as const },
  },
}

export const listItemVariants = {
  hidden: { opacity: 0, y: -4 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: Math.min(i, 8) * 0.02, duration: 0.14 },
  }),
}

export const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
}

// Fast, consistent hover/tap feel for interactive elements (~120-180ms).
export const hoverTransition = { duration: 0.14, ease: 'easeOut' as const }
export const hoverLift = { scale: 1.015 }
export const tapShrink = { scale: 0.985 }

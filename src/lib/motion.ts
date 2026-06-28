/*
 * Shared Framer Motion presets (v0.4 "Motion") — the JS half of Harmony's single
 * motion source. The CSS half lives in src/theme/motion.css; the duration/easing
 * numbers are mirrored between the two (Framer transitions are plain JS numbers,
 * not CSS custom properties, so they cannot read the CSS tokens at runtime).
 * Keep the two in sync — see design-language.md §3.5.
 *
 * Components import DUR / EASE_OUT / SPRING / variants from here instead of
 * hard-coding spring stiffness/damping or duration literals, so motion is tuned
 * in one place. Reduced-motion is honoured globally by <MotionConfig
 * reducedMotion="user"> in App.tsx, so presets do not branch on it themselves.
 */
import type { Transition, Variants } from "framer-motion";

/** Durations in SECONDS (Framer's unit). Mirror --harmony-dur-* in motion.css. */
export const DUR = {
  fast: 0.12, // 120ms — --aura-dur-fast
  base: 0.2, // 200ms — --aura-dur-base
  slow: 0.36, // 360ms — --aura-dur-slow
  entrance: 0.18, // content rise-in (hero, list items) — Harmony choice
} as const;

/** Cubic-bezier easing arrays. Mirror --harmony-ease-* in motion.css. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const; // --aura-ease-out (settle)
export const EASE_STANDARD = [0.2, 0, 0, 1] as const; // --aura-ease-standard

/** Stagger step between children, in seconds. */
export const STAGGER = {
  sm: 0.05,
  md: 0.08,
} as const;

/**
 * Spring presets, gentle → snappy. One named set so every spring in the app
 * pulls from the same vocabulary instead of ad-hoc stiffness/damping pairs.
 */
export const SPRING = {
  gentle: { type: "spring", stiffness: 260, damping: 26 },
  responsive: { type: "spring", stiffness: 300, damping: 26 },
  snappy: { type: "spring", stiffness: 320, damping: 28 },
} as const satisfies Record<string, Transition>;

// ── Shared variants ──────────────────────────────────────────────────────────

/** Page/route crossfade — keep it quiet; the user is navigating, not arriving. */
export const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.fast, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: EASE_STANDARD } },
} as const;

/** A staggered list container — children animate in sequence. */
export const listContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER.sm } },
};

/** A single list/grid item rising into place. Pair with `listContainer`. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.entrance, ease: EASE_OUT },
  },
};

/** Content rise-in for a single block (e.g. the hero teaser). */
export const riseIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR.entrance, ease: EASE_OUT },
} as const;

/** A panel/dialog entrance — fade + subtle scale settle. */
export const dialogPop = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: SPRING.responsive },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DUR.fast } },
} as const;

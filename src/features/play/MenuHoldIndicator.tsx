// MenuHoldIndicator — the "holding Start will open the menu" affordance
// (v0.28 W279, controller-input-design.md §Gameplay menu trigger). Renders a
// small progress ring while `progress` (0..1, from useGameplayMenuTrigger's
// onProgress) is building toward the hold-open threshold; hidden the instant
// progress returns to 0 (released, chorded past, or the overlay opened).
//
// Reduced motion: the ring's fill is driven by an SVG `stroke-dashoffset`
// STYLE property recomputed every tick from `progress`, not a CSS
// transition/animation — so there is no per-component motion for the app's
// central reduced-motion policy (motion.css) to have to zero out. The one
// motion this component asks for — the container's fade-in/out — uses the
// `--rgp-dur-fast` CSS transition token, which IS covered by that central
// `@media (prefers-reduced-motion: reduce)` rule (it collapses to a plain,
// instant show/hide there, which is the documented "static/stepped is fine"
// fallback for this affordance).

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface MenuHoldIndicatorProps {
  /** 0 (not holding) to 1 (threshold reached — the overlay is about to open). */
  progress: number;
}

/** A small ring that fills clockwise as Start is held toward the W279
 * hold-to-open-menu threshold. Renders nothing (not just hidden) at progress
 * 0 so it never intercepts pointer events or sits in the layout while idle. */
export function MenuHoldIndicator({ progress }: MenuHoldIndicatorProps) {
  if (progress <= 0) return null;
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = CIRCUMFERENCE * (1 - clamped);

  return (
    <div className="rgp-hold-indicator" role="status" aria-label="Holding Start will open the menu">
      <svg
        className="rgp-hold-indicator__ring"
        viewBox="0 0 40 40"
        aria-hidden="true"
      >
        <circle className="rgp-hold-indicator__track" cx="20" cy="20" r={RADIUS} />
        <circle
          className="rgp-hold-indicator__fill"
          cx="20"
          cy="20"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="rgp-hold-indicator__label">Hold for menu</span>
    </div>
  );
}

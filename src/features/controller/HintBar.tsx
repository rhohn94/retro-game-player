// HintBar (W14, harmony-ux-design.md §0). The persistent footer showing the live
// controller button hints for the focused context, using Xelu/PromptFont-style
// glyphs resolved per active device family. Screens pass an ordered list of
// `{ action, label }` hints; the bar renders each as "<glyph> <label>". It reads
// the active family from the controller context so the glyphs always match the
// connected pad (e.g. ✕/○ on PlayStation, Ⓐ/Ⓑ on Xbox).

import { useController } from "./hooks";
import { glyphFor, MOVE_GLYPH } from "./glyphs";
import type { SemanticAction } from "./actions";

/** One hint in the bar: a semantic action and the verb to show for it. */
export interface Hint {
  action: SemanticAction;
  /** Optional override of the default verb (e.g. "Play" instead of "Confirm"). */
  label?: string;
}

/** A synthetic "Move" hint spanning all four nav directions (◀▶▲▼ Move). */
export const MOVE_HINT = { glyph: MOVE_GLYPH, label: "Move" } as const;

export interface HintBarProps {
  /** Ordered hints for the focused context. */
  hints: ReadonlyArray<Hint>;
  /** Prepend the combined "◀▶▲▼ Move" hint (most screens want this). */
  showMove?: boolean;
}

export function HintBar({ hints, showMove = true }: HintBarProps) {
  const { family } = useController();
  return (
    <footer
      className="harmony-hintbar"
      style={{
        display: "flex",
        gap: 20,
        alignItems: "center",
        padding: "8px 16px",
        fontSize: 13,
        color: "var(--aura-on-surface-muted)",
      }}
      aria-label="Controller hints"
    >
      {showMove && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span aria-hidden style={{ fontSize: 15 }}>
            {MOVE_HINT.glyph}
          </span>
          {MOVE_HINT.label}
        </span>
      )}
      {hints.map((h) => {
        const g = glyphFor(family, h.action);
        return (
          <span
            key={h.action}
            style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>
              {g.glyph}
            </span>
            {h.label ?? g.label}
          </span>
        );
      })}
    </footer>
  );
}

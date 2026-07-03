// HintBar (W14, harmony-ux-design.md §0). The persistent footer showing the live
// controller button hints for the focused context, using Xelu/PromptFont-style
// glyphs resolved per active device family. Screens pass an ordered list of
// `{ action, label }` hints; the bar renders each as "<glyph> <label>". It reads
// the active family from the controller context so the glyphs always match the
// connected pad (e.g. ✕/○ on PlayStation, Ⓐ/Ⓑ on Xbox).
//
// W268: also optionally renders the non-standard-mapping degradation hint (see
// `useGamepadPoll`'s `onMappingDegraded`/`describeMappingDegradation`) so a pad
// that fails the "standard" mapping check gets a visible, dismissible notice
// instead of silently-possibly-wrong input.

import { useState } from "react";
import { useController } from "./hooks";
import { glyphFor, MOVE_GLYPH } from "./glyphs";
import type { PlayStationModel, SemanticAction } from "./actions";
import type { MappingDegradationNotice } from "./useGamepadPoll";

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
  /**
   * A non-standard-mapping degradation notice to surface (from
   * `useGamepadPoll`'s `onMappingDegraded` callback), or null/undefined when
   * the active pad reports a standard mapping. Dismissible; re-appears only if
   * a *different* notice is passed in (a new degraded family this session).
   */
  mappingNotice?: MappingDegradationNotice | null;
  /**
   * The detected PlayStation pad model (from `detectPlayStationModel`), used
   * to pick the right Share (DualShock 4) vs Create (DualSense) legend for the
   * `quit` hint. Ignored for non-PlayStation families.
   */
  psModel?: PlayStationModel;
}

export function HintBar({ hints, showMove = true, mappingNotice, psModel }: HintBarProps) {
  const { family } = useController();
  const [dismissed, setDismissed] = useState<MappingDegradationNotice | null>(null);
  const showNotice = mappingNotice != null && mappingNotice !== dismissed;

  return (
    <>
      {showNotice && (
        <div
          className="rgp-hintbar__degradation"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "6px 16px",
            fontSize: 12,
            color: "var(--aura-on-surface-muted)",
            background: "var(--aura-surface-raised)",
          }}
        >
          <span aria-hidden>⚠</span>
          <span style={{ flex: 1 }}>
            {mappingNotice.message} {mappingNotice.hint}
          </span>
          <button
            type="button"
            aria-label="Dismiss controller mapping notice"
            onClick={() => setDismissed(mappingNotice)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontSize: 12,
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}
      <footer
        className="rgp-hintbar"
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
          const g = glyphFor(family, h.action, psModel);
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
    </>
  );
}

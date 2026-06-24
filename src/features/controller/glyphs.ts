// Button-glyph mapping (W14, controller-input-design.md §4). Maps a semantic
// action to the on-screen glyph + label shown in the HintBar, per device family.
// Glyphs follow the Xelu / PromptFont convention (Ⓐ Ⓑ Ⓧ Ⓨ circled face buttons,
// directional arrows). Pure data + lookup so the HintBar stays dumb.

import type { DeviceFamily, SemanticAction } from "./actions";

/** What the HintBar renders for one hint: a glyph and a short verb. */
export interface Glyph {
  glyph: string;
  /** Default human label for the action (a screen may override the verb). */
  label: string;
}

// Face-button legend per family. confirm/back map to whichever physical face
// button the family binds (matching actions.ts CONFIRM_BACK), so the glyph the
// user sees always matches the button they must press.
const FACE: Record<DeviceFamily, { confirm: string; back: string; menuFace: string; altFace: string }> = {
  xbox: { confirm: "Ⓐ", back: "Ⓑ", menuFace: "Ⓨ", altFace: "Ⓧ" },
  playstation: { confirm: "✕", back: "○", menuFace: "△", altFace: "□" },
  "8bitdo": { confirm: "Ⓐ", back: "Ⓑ", menuFace: "Ⓨ", altFace: "Ⓧ" },
  // Switch Pro: physical A is on the right (confirm), B at the bottom (back).
  switch_pro: { confirm: "Ⓐ", back: "Ⓑ", menuFace: "Ⓧ", altFace: "Ⓨ" },
  generic: { confirm: "Ⓐ", back: "Ⓑ", menuFace: "Ⓨ", altFace: "Ⓧ" },
};

/** Resolve the glyph + default label for a semantic action on a device family. */
export function glyphFor(family: DeviceFamily, action: SemanticAction): Glyph {
  const face = FACE[family];
  switch (action) {
    case "confirm":
      return { glyph: face.confirm, label: "Confirm" };
    case "back":
      return { glyph: face.back, label: "Back" };
    case "menu":
      return { glyph: "☰", label: "Menu" };
    case "quit":
      return { glyph: "⊗", label: "Quit" };
    case "nav_up":
      return { glyph: "▲", label: "Up" };
    case "nav_down":
      return { glyph: "▼", label: "Down" };
    case "nav_left":
      return { glyph: "◀", label: "Left" };
    case "nav_right":
      return { glyph: "▶", label: "Right" };
    default:
      return { glyph: "•", label: action };
  }
}

/** The combined ◀▶▲▼ glyph used for "Move" hints (D-pad / stick navigation). */
export const MOVE_GLYPH = "◀▶▲▼";

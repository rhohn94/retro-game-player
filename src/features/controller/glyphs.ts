// Button-glyph mapping (W14, controller-input-design.md §4). Maps a semantic
// action to the on-screen glyph + label shown in the HintBar, per device family.
// Glyphs follow the Xelu / PromptFont convention (Ⓐ Ⓑ Ⓧ Ⓨ circled face buttons,
// directional arrows). Pure data + lookup so the HintBar stays dumb.
//
// W268: PlayStation's `menu`/`quit` semantic actions bind to the physical
// Options/Share(Create) buttons (actions.ts DPAD_BINDINGS: menu -> start,
// quit -> select) — those buttons carry family-specific legends, and DualSense
// renamed "Share" to "Create" versus DualShock 4, so glyphFor takes an optional
// `PlayStationModel` to pick the right label (see detectPlayStationModel).

import type { DeviceFamily, PlayStationModel, SemanticAction } from "./actions";

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

// PlayStation's `start`/`select` buttons carry model-specific legends rather
// than a generic "Menu"/"Quit" — Options is stable across DS4/DualSense, but
// the left button was renamed Share (DS4) -> Create (DualSense).
const PLAYSTATION_MENU_LABEL = { glyph: "☰", label: "Options" } as const;
const PLAYSTATION_QUIT_LABEL: Record<"dualshock4" | "dualsense" | "unknown", Glyph> = {
  dualshock4: { glyph: "⊗", label: "Share" },
  dualsense: { glyph: "⊗", label: "Create" },
  unknown: { glyph: "⊗", label: "Share/Create" },
};

/**
 * Resolve the glyph + default label for a semantic action on a device family.
 * `psModel` refines PlayStation's menu/quit labels (Share vs Create); omit it
 * (or pass a non-playstation family) to get the family-generic label.
 */
export function glyphFor(
  family: DeviceFamily,
  action: SemanticAction,
  psModel?: PlayStationModel,
): Glyph {
  const face = FACE[family];
  switch (action) {
    case "confirm":
      return { glyph: face.confirm, label: "Confirm" };
    case "back":
      return { glyph: face.back, label: "Back" };
    case "menu":
      return family === "playstation" ? PLAYSTATION_MENU_LABEL : { glyph: "☰", label: "Menu" };
    case "quit":
      return family === "playstation"
        ? PLAYSTATION_QUIT_LABEL[psModel ?? "unknown"]
        : { glyph: "⊗", label: "Quit" };
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

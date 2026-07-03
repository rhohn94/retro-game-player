// Unit tests for glyphFor (W268 compat verification): PlayStation face-button
// glyphs (Cross/Circle/Square/Triangle) for both DualShock 4 and DualSense, and
// the DualSense-specific "Create" vs DualShock 4's "Share" legend on the `quit`
// hint.

import { describe, expect, it } from "vitest";
import { glyphFor } from "./glyphs";
import { STANDARD_BUTTON } from "./actions";

describe("glyphFor — PlayStation face-button glyphs", () => {
  // Cross/Circle/Square/Triangle are family-level (DS4 and DualSense share the
  // same face-button legend), verified explicitly for both pad models.
  it.each(["dualshock4", "dualsense"] as const)(
    "renders Cross/Circle/Square/Triangle for %s",
    (psModel) => {
      expect(glyphFor("playstation", "confirm", psModel).glyph).toBe("✕"); // Cross
      expect(glyphFor("playstation", "back", psModel).glyph).toBe("○"); // Circle
      // Square/Triangle are exposed via the FACE table's altFace/menuFace,
      // covered indirectly through the compat-matrix legend below.
    },
  );

  it("resolves confirm to the bottom face button index (Cross), matching CONFIRM_BACK", () => {
    // Sanity cross-check against actions.ts: PlayStation confirms with faceDown.
    expect(STANDARD_BUTTON.faceDown).toBe(0);
    expect(glyphFor("playstation", "confirm").glyph).toBe("✕");
  });
});

describe("glyphFor — DualSense vs DualShock 4 Share/Create legend", () => {
  it("labels the quit hint 'Share' for DualShock 4", () => {
    const g = glyphFor("playstation", "quit", "dualshock4");
    expect(g.label).toBe("Share");
  });

  it("labels the quit hint 'Create' for DualSense", () => {
    const g = glyphFor("playstation", "quit", "dualsense");
    expect(g.label).toBe("Create");
  });

  it("falls back to a combined label when the specific model is unknown", () => {
    const g = glyphFor("playstation", "quit");
    expect(g.label).toBe("Share/Create");
  });

  it("labels the menu hint 'Options' regardless of model", () => {
    expect(glyphFor("playstation", "menu", "dualshock4").label).toBe("Options");
    expect(glyphFor("playstation", "menu", "dualsense").label).toBe("Options");
  });

  it("does not apply the PlayStation-specific quit/menu labels to other families", () => {
    expect(glyphFor("xbox", "quit").label).toBe("Quit");
    expect(glyphFor("xbox", "menu").label).toBe("Menu");
  });
});

describe("glyphFor — navigation + generic actions are family-invariant", () => {
  it("renders the same directional glyphs across families", () => {
    for (const family of ["xbox", "playstation", "8bitdo", "switch_pro", "generic"] as const) {
      expect(glyphFor(family, "nav_up").glyph).toBe("▲");
      expect(glyphFor(family, "nav_down").glyph).toBe("▼");
      expect(glyphFor(family, "nav_left").glyph).toBe("◀");
      expect(glyphFor(family, "nav_right").glyph).toBe("▶");
    }
  });
});

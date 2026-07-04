// Unit tests for the pure keyboard → semantic-action mapping (W283). No DOM
// required — mirrors the actions.test.ts / spatial.test.ts pattern of testing
// the pure classification logic in isolation from any listener/hardware.

import { describe, expect, it } from "vitest";
import {
  isControlGuardExempt,
  isNativeActivationTarget,
  isNativeControlTarget,
  keyToSemanticAction,
} from "./keyboardMap";

describe("keyToSemanticAction", () => {
  it("maps arrow keys to the four nav actions", () => {
    expect(keyToSemanticAction("ArrowUp")).toBe("nav_up");
    expect(keyToSemanticAction("ArrowDown")).toBe("nav_down");
    expect(keyToSemanticAction("ArrowLeft")).toBe("nav_left");
    expect(keyToSemanticAction("ArrowRight")).toBe("nav_right");
  });

  it("maps Enter and Space (both key spellings) to confirm", () => {
    expect(keyToSemanticAction("Enter")).toBe("confirm");
    expect(keyToSemanticAction(" ")).toBe("confirm");
    expect(keyToSemanticAction("Spacebar")).toBe("confirm");
  });

  it("maps Escape to back", () => {
    expect(keyToSemanticAction("Escape")).toBe("back");
  });

  it("returns null for every key this module has no opinion on", () => {
    expect(keyToSemanticAction("a")).toBeNull();
    expect(keyToSemanticAction("Tab")).toBeNull();
    expect(keyToSemanticAction("Shift")).toBeNull();
    expect(keyToSemanticAction("F11")).toBeNull();
    expect(keyToSemanticAction("")).toBeNull();
  });
});

describe("isNativeControlTarget", () => {
  it("is true for input/textarea/select tag names", () => {
    expect(isNativeControlTarget({ tagName: "INPUT" })).toBe(true);
    expect(isNativeControlTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isNativeControlTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("is true for a contenteditable region regardless of tag name", () => {
    expect(isNativeControlTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for a plain element, null, or undefined", () => {
    expect(isNativeControlTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isNativeControlTarget({ tagName: "DIV" })).toBe(false);
    expect(isNativeControlTarget(null)).toBe(false);
    expect(isNativeControlTarget(undefined)).toBe(false);
  });
});

describe("isControlGuardExempt", () => {
  it("exempts Escape so it always closes overlays regardless of focus", () => {
    expect(isControlGuardExempt("Escape")).toBe(true);
  });

  it("does not exempt arrows/Enter/Space — native controls keep those", () => {
    expect(isControlGuardExempt("ArrowUp")).toBe(false);
    expect(isControlGuardExempt("Enter")).toBe(false);
    expect(isControlGuardExempt(" ")).toBe(false);
  });
});

describe("isNativeActivationTarget", () => {
  it("is true for a real button/link/summary", () => {
    expect(isNativeActivationTarget({ tagName: "BUTTON" })).toBe(true);
    expect(isNativeActivationTarget({ tagName: "A" })).toBe(true);
    expect(isNativeActivationTarget({ tagName: "SUMMARY" })).toBe(true);
  });

  it("is true for an activatable ARIA role on a non-native element", () => {
    expect(isNativeActivationTarget({ tagName: "DIV", role: "button" })).toBe(true);
    expect(isNativeActivationTarget({ tagName: "DIV", role: "menuitem" })).toBe(true);
    expect(isNativeActivationTarget({ tagName: "DIV", role: "tab" })).toBe(true);
    expect(isNativeActivationTarget({ tagName: "DIV", role: "link" })).toBe(true);
  });

  it("is false for a disabled button — it cannot self-activate", () => {
    expect(isNativeActivationTarget({ tagName: "BUTTON", disabled: true })).toBe(false);
  });

  it("is false for plain elements, non-activatable roles, null, or undefined", () => {
    expect(isNativeActivationTarget({ tagName: "DIV" })).toBe(false);
    expect(isNativeActivationTarget({ tagName: "DIV", role: "option" })).toBe(false);
    expect(isNativeActivationTarget({ tagName: "INPUT" })).toBe(false);
    expect(isNativeActivationTarget(null)).toBe(false);
    expect(isNativeActivationTarget(undefined)).toBe(false);
  });
});

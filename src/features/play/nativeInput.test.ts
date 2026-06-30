import { describe, expect, it } from "vitest";
import { computeJoypadBits, isBoundKey, JOYPAD_BIT } from "./nativeInput";

describe("computeJoypadBits", () => {
  it("returns 0 when nothing is held and no gamepad is present", () => {
    expect(computeJoypadBits(new Set(), null)).toBe(0);
  });

  it("sets the bit for a single held key", () => {
    expect(computeJoypadBits(new Set(["KeyX"]), null)).toBe(1 << JOYPAD_BIT.A);
  });

  it("combines bits for multiple held keys", () => {
    const bits = computeJoypadBits(new Set(["ArrowUp", "ArrowRight", "KeyX"]), null);
    expect(bits).toBe((1 << JOYPAD_BIT.UP) | (1 << JOYPAD_BIT.RIGHT) | (1 << JOYPAD_BIT.A));
  });

  it("ignores key codes that aren't bound", () => {
    expect(computeJoypadBits(new Set(["KeyQ", "Space"]), null)).toBe(0);
  });

  it("reads gamepad face/dpad/start/select buttons via the standard mapping", () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    buttons[0] = { pressed: true }; // faceDown -> B
    buttons[9] = { pressed: true }; // start
    const bits = computeJoypadBits(new Set(), { buttons });
    expect(bits).toBe((1 << JOYPAD_BIT.B) | (1 << JOYPAD_BIT.START));
  });

  it("merges keyboard and gamepad input into one bitmask", () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    buttons[12] = { pressed: true }; // dpadUp
    const bits = computeJoypadBits(new Set(["KeyZ"]), { buttons });
    expect(bits).toBe((1 << JOYPAD_BIT.B) | (1 << JOYPAD_BIT.UP));
  });

  it("treats an out-of-range gamepad button index as not pressed", () => {
    const bits = computeJoypadBits(new Set(), { buttons: [] });
    expect(bits).toBe(0);
  });
});

describe("isBoundKey", () => {
  it("is true for every key bound in KEY_BINDINGS", () => {
    expect(isBoundKey("ArrowUp")).toBe(true);
    expect(isBoundKey("KeyX")).toBe(true);
    expect(isBoundKey("Tab")).toBe(true);
  });

  it("is false for an unbound key", () => {
    expect(isBoundKey("KeyQ")).toBe(false);
  });
});

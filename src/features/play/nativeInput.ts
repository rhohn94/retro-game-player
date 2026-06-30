// Native input mapping (v0.21 "Bedrock" W216) — translates keyboard and
// gamepad state into the RETRO_DEVICE_ID_JOYPAD_* bitmask the Rust runtime's
// `play::native::set_joypad_state` reads each core poll (pushed over IPC via
// `setNativeInput`). Bit `n` mirrors libretro's RETRO_DEVICE_ID_JOYPAD_* value
// `n` exactly (see src-tauri/src/play/native/ffi.rs) — no translation needed
// on the Rust side.
//
// Keyboard defaults mirror EmulatorJS's documented NES keybindings (arrows +
// X/Z/Enter/Tab) so flipping the native-play flag doesn't retrain muscle
// memory. Gamepad defaults reuse the same STANDARD_BUTTON indices the
// menu-navigation controller subsystem already binds (src/features/controller/
// actions.ts) — both EmulatorJS and Harmony's own UI follow the W3C
// "standard" gamepad mapping, so it's the same physical buttons either way.
//
// Pure (no DOM, no IPC) so the bit math is unit-testable without a real
// keyboard or gamepad; NativePlayer.tsx is the only impure caller.

import { STANDARD_BUTTON } from "../controller/actions";

/** One NES joypad button, named after its `RETRO_DEVICE_ID_JOYPAD_*` bit. */
export type NesButton =
  | "B"
  | "Y"
  | "SELECT"
  | "START"
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "A"
  | "X"
  | "L"
  | "R";

/** Bit index for each button — mirrors `RETRO_DEVICE_ID_JOYPAD_*` exactly. */
export const JOYPAD_BIT: Record<NesButton, number> = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
};

/** `KeyboardEvent.code` -> NES button (EmulatorJS's documented NES defaults). */
export const KEY_BINDINGS: Record<string, NesButton> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  KeyX: "A",
  KeyZ: "B",
  Enter: "START",
  Tab: "SELECT",
};

/** Standard-mapping gamepad button index -> NES button. */
export const GAMEPAD_BINDINGS: Record<number, NesButton> = {
  [STANDARD_BUTTON.faceDown]: "B",
  [STANDARD_BUTTON.faceRight]: "A",
  [STANDARD_BUTTON.select]: "SELECT",
  [STANDARD_BUTTON.start]: "START",
  [STANDARD_BUTTON.dpadUp]: "UP",
  [STANDARD_BUTTON.dpadDown]: "DOWN",
  [STANDARD_BUTTON.dpadLeft]: "LEFT",
  [STANDARD_BUTTON.dpadRight]: "RIGHT",
};

/** Minimal shape of a `Gamepad` this module needs, so tests don't require a real one. */
export interface GamepadButtonsSource {
  buttons: ReadonlyArray<{ pressed: boolean }>;
}

/**
 * Computes the joypad bitmask for one poll tick from the currently-held
 * keyboard codes and the active gamepad's button state (if any).
 */
export function computeJoypadBits(
  heldKeys: ReadonlySet<string>,
  gamepad: GamepadButtonsSource | null,
): number {
  let bits = 0;
  for (const code of heldKeys) {
    const button = KEY_BINDINGS[code];
    if (button) bits |= 1 << JOYPAD_BIT[button];
  }
  if (gamepad) {
    for (const [indexStr, button] of Object.entries(GAMEPAD_BINDINGS)) {
      if (gamepad.buttons[Number(indexStr)]?.pressed) bits |= 1 << JOYPAD_BIT[button];
    }
  }
  return bits;
}

/** Whether a key code is one the native player binds — used to decide whether
 * to preventDefault (e.g. stop arrow keys/Tab from scrolling or shifting focus). */
export function isBoundKey(code: string): boolean {
  return code in KEY_BINDINGS;
}

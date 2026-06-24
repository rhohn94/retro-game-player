// Public barrel for the controller-input feature (W14). Screens import the
// provider, hooks, and overlay components from here. Pure helper modules
// (actions/spatial/glyphs) are re-exported for testing + advanced consumers.

export * from "./actions";
export * from "./spatial";
export * from "./glyphs";
export { useGamepadPoll } from "./useGamepadPoll";
export { ControllerProvider, ControllerContext } from "./ControllerProvider";
export type { ControllerContextValue, ActionHandlers } from "./ControllerProvider";
export { useController, useFocusable } from "./hooks";
export type { UseFocusableResult } from "./hooks";
export { FocusRing, focusRingStyle } from "./FocusRing";
export { HintBar, MOVE_HINT } from "./HintBar";
export type { Hint, HintBarProps } from "./HintBar";

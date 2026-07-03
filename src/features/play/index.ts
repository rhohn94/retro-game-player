// Public barrel for the play feature (W225). Screens import the player
// switch from here rather than reaching into individual player modules.
// W273 adds the TV hover-attract's needs: the native player mounted directly
// in the "preview" presentation, and the shared native-path eligibility gate.

export { PlaySwitch } from "./PlaySwitch";
export type { PlaySwitchProps } from "./PlaySwitch";
export { NativePlayer } from "./NativePlayer";
export type { NativePlayerProps } from "./NativePlayer";
export { NATIVE_SYSTEM, isNativePathEligible } from "./nativePath";

// Public barrel for the play feature (W225). Screens import the player
// switch from here rather than reaching into individual player modules.
// W273 adds the TV hover-attract's needs: the native player mounted directly
// in the "preview" presentation, and the shared native-path eligibility gate.
// W376 adds the in-page player's own direct mount + the two-path (native/EJS)
// preview resolver, since the TV hover-attract now previews both play paths.

export { PlaySwitch } from "./PlaySwitch";
export type { PlaySwitchProps } from "./PlaySwitch";
export { NativePlayer } from "./NativePlayer";
export type { NativePlayerProps } from "./NativePlayer";
export { InPagePlayer } from "./InPagePlayer";
export type { InPagePlayerProps } from "./InPagePlayer";
export { NATIVE_SYSTEM, fetchNativeCapabilities, isNativePathEligible } from "./nativePath";
export type { NativeCapabilities } from "./nativePath";
export { resolveAttractPreviewPath } from "./attractPreviewPath";
export type { AttractPreviewPath } from "./attractPreviewPath";
export { PS1_BIOS_NOTICE, shouldShowPs1BiosNotice } from "./ps1BiosCopy";

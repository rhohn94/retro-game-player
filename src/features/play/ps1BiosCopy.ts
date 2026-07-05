// ps1BiosCopy — the PS1-specific HLE-BIOS honesty notice (v0.34 "Engines"
// W344). pcsx_rearmed boots most PS1 titles on its own built-in HLE
// (high-level emulation) BIOS with no real BIOS file installed — but a
// minority of titles need a real PlayStation BIOS dropped into RetroArch's
// system folder to boot at all. This is not a play-path *degradation*
// (native play IS what's about to run) so it doesn't go through
// `degradation.ts`'s dismiss-once-per-cause funnel — it's a standing, factual
// notice shown every time the native PS1 path is about to be used, the same
// way `GameDetailPage` always shows the game's system/size metadata rather
// than a one-time toast.

/** Whether the PS1 HLE-BIOS notice should show: true exactly when `system`
 * is PS1 and the native play path is what's about to render (mirrors
 * `nativePath.ts`'s own "would this game take the native path" question —
 * callers already have that answer before deciding which player to mount). */
export function shouldShowPs1BiosNotice(system: string, nativePathActive: boolean): boolean {
  return nativePathActive && system === "ps1";
}

/** The notice copy shown on a PS1 game's detail page once the native path
 * is active. Single-disc scope note lives here too — pcsx_rearmed plays disc
 * 1 of a multi-disc game only; there is no in-app disc-swap control this
 * release (native-emulation-design.md, "Multi-system engine" PS1 note). */
export const PS1_BIOS_NOTICE = {
  message:
    "Runs on an emulated (HLE) BIOS — some titles need a real PlayStation BIOS in RetroArch's system folder.",
  hint: "Multi-disc games play disc 1 only — there's no in-app disc-swap control yet.",
} as const;

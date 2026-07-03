// Public barrel for the tv feature (v0.26 W260, tv-mode-design.md). App.tsx
// and later TV passes (W261 TV home, W262 focus, W265 transitions) import
// from here rather than reaching into individual files.

export { TvModeProvider, useTvMode } from "./TvModeContext";
export type { TvModeContextValue, TvLaunch } from "./TvModeContext";
export { TvShell } from "./TvShell";
export { TvHome } from "./TvHome";
export { TvGameSurface } from "./TvGameSurface";
export { TvSystemMenu } from "./TvSystemMenu";
export { TvEmbeddedScreen } from "./TvEmbeddedScreen";
export { TV_MENU_ITEMS, nextMenuIndex } from "./systemMenu";
export type { TvMenuDestination, TvMenuItem } from "./systemMenu";
export { useAutoTvModeOnStartup } from "./useAutoTvModeOnStartup";
export { useTvModeControllerToggle } from "./useTvModeControllerToggle";
export { useTvSystemMenuTrigger } from "./useTvSystemMenuTrigger";

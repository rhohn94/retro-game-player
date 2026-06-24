// Route table — the append-friendly routing seam (architecture-design.md §1.1).
// Each screen work item (W13/W15/W16/W17) adds EXACTLY ONE entry to the
// HARMONY_ROUTES array below, mapping its route path to its feature page; no
// item edits another's entry, so the integration master merges by concatenation.
//
// W2 seeds the table with lightweight placeholder pages so the shell + router
// render end-to-end now; later items swap the `element` for the real screen.

import type { ReactElement } from "react";
import { CoresPage } from "./features/cores"; // W16
import { GameDetailPage, LibraryPage } from "./features/library"; // W13
import { SearchPage } from "./features/search/SearchPage"; // W17
import { SettingsPage } from "./features/settings/SettingsPage"; // W15

/** One screen in the app: a route path, its element, and a nav label. */
export interface HarmonyRoute {
  /** react-router path (relative to the shell). */
  path: string;
  /** The screen element rendered at this path. */
  element: ReactElement;
  /** Sidebar label; omit to keep the route out of the primary nav. */
  navLabel?: string;
  /** True for the index route (path "/"). */
  index?: boolean;
}

// APPEND POINT — each screen item adds ONE object. Keep ordered by route.
export const HARMONY_ROUTES: readonly HarmonyRoute[] = [
  {
    path: "/",
    index: true,
    navLabel: "Library",
    element: <LibraryPage />,
  },
  {
    path: "/cores",
    navLabel: "Cores",
    element: <CoresPage />, // W16
  },
  {
    path: "/search",
    navLabel: "Search",
    element: <SearchPage />, // W17 — real screen
  },
  {
    path: "/settings",
    navLabel: "Settings",
    element: <SettingsPage />, // W15
  },
  {
    path: "/game/:id",
    element: <GameDetailPage />,
  }, // W13 (no nav entry)
];

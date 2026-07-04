// TvSystemMenu — the 10-foot system-menu overlay (v0.28 W278, tv-mode-
// design.md §v0.28 → W278). Opened by Select (any family) or the PlayStation
// touchpad click outside gameplay (useMenuTrigger, controller feature), or the
// pointer ☰ Menu button in TvShell's header. Lists the destinations every page
// in TV mode is reachable from: TV Home, Consoles, Search, Cores, Settings,
// Exit TV mode (systemMenu.ts's fixed TV_MENU_ITEMS).
//
// While open this claims "ui" on the controller's exclusive stack ABOVE
// whatever TvHome (or an embedded screen's own base-spatial-nav registrations)
// already holds: nav_up/nav_down move the selected row (systemMenu.ts's pure
// nextMenuIndex, no wraparound), confirm activates the selected row,
// back/Select-again close the menu without navigating. The claim is installed
// for the panel's mount lifetime — closing unmounts it, uncovering whatever
// claim sits beneath (the exclusive-claim-stack release-by-identity contract,
// exclusiveStack.ts), so control returns to TvHome/the embedded screen exactly
// as it was.
//
// Opening the menu also cancels an armed exit-confirm and disables the W273
// attract dwell (same "something more important is happening" gating family
// as `exitConfirm.confirming` — TvHome threads `tvMode.menuOpen` into
// useAttractDwell's `enabled` the same way it already threads `launched`/
// `exitConfirm.confirming`).

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";
import { dialogPop } from "../../lib/motion";
import { useController } from "../controller";
import type { SemanticAction } from "../controller";
import { useTvMode } from "./TvModeContext";
import { TV_MENU_ITEMS, nextMenuIndex, type TvMenuItem } from "./systemMenu";
import "./tv-system-menu.css";

/** Resolve a menu item's activation: routes to the right TvModeContext
 * transition per destination kind (systemMenu.ts §TvMenuDestination). */
function activate(item: TvMenuItem, tvMode: ReturnType<typeof useTvMode>): void {
  switch (item.destination.kind) {
    case "home":
      tvMode.returnToHome();
      tvMode.closeMenu();
      return;
    case "exit":
      tvMode.closeMenu();
      tvMode.exit();
      return;
    case "route":
      tvMode.enterEmbedded(item.destination.path);
      return;
  }
}

export function TvSystemMenu() {
  const tvMode = useTvMode();
  const { claimExclusive, setFocus, focusedId } = useController();

  // The selected row lives as controller focus (like every other TV-mode
  // surface): each row registers its own focus id below, seeded onto the
  // first row on open so the panel is immediately controller-operable.
  const selectedIndexRef = useRef(0);
  useEffect(() => {
    selectedIndexRef.current = 0;
    setFocus(TV_MENU_ITEMS[0].id);
    // Runs once per mount: `setFocus` is `ControllerProvider`'s stable
    // useCallback (empty dep array there), so listing it here does not cause
    // a re-seed on every re-render — only a genuine remount re-seeds, mirroring
    // TvHome's own one-shot focus-seed pattern (its `seededRef` guard).
  }, [setFocus]);

  // Keep a live index in sync with whatever focus id is active (pointer hover
  // moves focus too, same "hover funnels into controller focus" convention
  // TvTile/TvHero already use) so keyboard/controller nav resumes from the
  // row the pointer last touched, not a stale index.
  useEffect(() => {
    const idx = TV_MENU_ITEMS.findIndex((i) => i.id === focusedId);
    if (idx !== -1) selectedIndexRef.current = idx;
  }, [focusedId]);

  const closeRef = useRef(tvMode.closeMenu);
  closeRef.current = tvMode.closeMenu;
  const activateRef = useRef(() => activate(TV_MENU_ITEMS[0], tvMode));
  activateRef.current = () => activate(TV_MENU_ITEMS[selectedIndexRef.current], tvMode);

  const handleAction = useCallback(
    (action: SemanticAction) => {
      if (action === "back" || action === "quit") {
        closeRef.current();
        return;
      }
      if (action === "confirm") {
        activateRef.current();
        return;
      }
      if (action === "nav_up" || action === "nav_down") {
        const dir = action === "nav_up" ? "up" : "down";
        const next = nextMenuIndex(selectedIndexRef.current, dir);
        if (next !== selectedIndexRef.current) {
          selectedIndexRef.current = next;
          setFocus(TV_MENU_ITEMS[next].id);
        }
      }
      // nav_left / nav_right / menu — not a menu-panel concern.
    },
    [setFocus],
  );

  useEffect(() => claimExclusive(handleAction, "ui"), [claimExclusive, handleAction]);

  return (
    <motion.div
      className="rgp-tv-system-menu"
      role="dialog"
      aria-label="TV system menu"
      data-testid="tv-system-menu"
      initial={dialogPop.initial}
      animate={dialogPop.animate}
      exit={dialogPop.exit}
    >
      <p className="rgp-tv-system-menu__label">Menu</p>
      <ul className="rgp-tv-system-menu__list">
        {TV_MENU_ITEMS.map((item) => {
          const isFocused = focusedId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                className="rgp-tv-system-menu__item"
                data-focused={isFocused ? "true" : undefined}
                onMouseEnter={() => setFocus(item.id)}
                onClick={() => activate(item, tvMode)}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

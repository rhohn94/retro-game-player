// useOverlayMenu — composes the shared overlay's menu (v0.23 W232): the
// player's own items (Resume / Full screen / Exit) plus the Save state /
// Load state slot-picker sub-views, backed by `list_game_saves` and the
// per-path save/load implementations the player supplies (IPC for the
// native path, postMessage for the EmulatorJS iframe).

import { useCallback, useEffect, useRef, useState } from "react";
import { listGameSaves } from "../../ipc/native-play";
import type { GameSaves, SaveSlot } from "../../ipc/native-play";
import type { OverlayItem } from "./PlayerOverlay";
import { slotRows } from "./saveSlots";

export interface OverlayMenuConfig {
  gameId: number;
  activePath: "native" | "ejs";
  open: boolean;
  /** Shown first; typically Resume. */
  resume: OverlayItem;
  /** Player-specific extras (e.g. Full screen), between Load and Exit. */
  extras: OverlayItem[];
  /** Shown last; typically Exit game. */
  exit: OverlayItem;
  saveSlot: (slot: SaveSlot) => Promise<void>;
  loadSlot: (slot: SaveSlot) => Promise<void>;
  /** Called after a successful load — typically closes the overlay. */
  onLoaded: () => void;
  /** Called whenever the item list resets (view change) — reset selection. */
  onViewChange: () => void;
}

export interface OverlayMenu {
  items: OverlayItem[];
  status: string | null;
  /** Back to the main view (call when the overlay opens/closes). */
  resetView: () => void;
}

/** Builds the overlay's current item list (main view or a slot picker). */
export function useOverlayMenu(config: OverlayMenuConfig): OverlayMenu {
  const [view, setView] = useState<"main" | "save" | "load">("main");
  const [saves, setSaves] = useState<GameSaves | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Live config mirror so stable callbacks read current values.
  const cfg = useRef(config);
  cfg.current = config;

  const refreshSaves = useCallback(() => {
    listGameSaves(cfg.current.gameId)
      .then(setSaves)
      .catch(() => setSaves(null));
  }, []);

  // Refresh the inventory each time the overlay opens (cheap disk read).
  useEffect(() => {
    if (config.open) {
      setStatus(null);
      refreshSaves();
    }
  }, [config.open, refreshSaves]);

  const changeView = useCallback((next: "main" | "save" | "load") => {
    setView(next);
    setStatus(null);
    cfg.current.onViewChange();
  }, []);

  const resetView = useCallback(() => changeView("main"), [changeView]);

  const runSave = useCallback(
    (slot: SaveSlot) => {
      cfg.current
        .saveSlot(slot)
        .then(() => {
          setStatus(`Saved to slot ${slot}`);
          refreshSaves();
          changeView("main");
        })
        .catch((err: unknown) => {
          setStatus(err instanceof Error ? err.message : String(err));
        });
    },
    [refreshSaves, changeView],
  );

  const runLoad = useCallback(
    (slot: SaveSlot) => {
      cfg.current
        .loadSlot(slot)
        .then(() => {
          changeView("main");
          cfg.current.onLoaded();
        })
        .catch((err: unknown) => {
          setStatus(err instanceof Error ? err.message : String(err));
        });
    },
    [changeView],
  );

  let items: OverlayItem[];
  if (view === "main") {
    items = [
      config.resume,
      { key: "save", label: "Save state", run: () => changeView("save") },
      { key: "load", label: "Load state", run: () => changeView("load") },
      ...config.extras,
      config.exit,
    ];
  } else {
    const mode = view;
    items = [
      ...slotRows(saves, config.activePath, mode).map((row) => ({
        key: `slot-${row.slot}`,
        label: row.label,
        // Loading needs a state this path wrote; saving overwrites anything.
        disabled: mode === "load" && (!row.occupied || row.foreign),
        run: () => (mode === "save" ? runSave(row.slot) : runLoad(row.slot)),
      })),
      { key: "back", label: "Back", run: () => changeView("main") },
    ];
  }

  return { items, status, resetView };
}

// Controller context + provider (W14, controller-input-design.md §3). Owns the
// single focus target, a registry of focusable elements, the live device family,
// and the persisted-bindings cache. Wires `useGamepadPoll` so D-pad/stick moves
// focus spatially, `confirm` activates the focused element, and `back`/`menu`
// dispatch to the active screen's registered handlers. Screens consume this via
// the `useFocusable` and `useController` hooks (see hooks.ts).

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DeviceFamily, SemanticAction } from "./actions";
import { listBindings, type ControllerBinding } from "../../ipc/controllers";
import { nextFocus, navDirection, type FocusTarget } from "./spatial";
import { useGamepadPoll } from "./useGamepadPoll";

/** A registered focusable: its element (for geometry + activation) and callbacks. */
interface FocusEntry {
  id: string;
  el: HTMLElement;
  onActivate?: () => void;
}

/** Per-screen action handlers (back/menu/quit) the active screen can register. */
export type ActionHandlers = Partial<Record<SemanticAction, () => void>>;

/** The controller context surface consumed by screens. */
export interface ControllerContextValue {
  /** The id of the currently focused element, or null. */
  focusedId: string | null;
  /** Programmatically move focus to an id (e.g. on screen mount). */
  setFocus: (id: string | null) => void;
  /** Register a focusable; returns an unregister cleanup. */
  register: (entry: FocusEntry) => () => void;
  /** The active controller's device family (drives HintBar glyphs). */
  family: DeviceFamily;
  /** Register screen-level handlers for non-focus actions (back/menu/quit). */
  setActionHandlers: (handlers: ActionHandlers) => void;
}

export const ControllerContext = createContext<ControllerContextValue | null>(null);

/** Reads the live rects of all registered focusables for the spatial engine. */
function readTargets(entries: Map<string, FocusEntry>): FocusTarget[] {
  const out: FocusTarget[] = [];
  for (const e of entries.values()) {
    const r = e.el.getBoundingClientRect();
    out.push({ id: e.id, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
  }
  return out;
}

export function ControllerProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [family, setFamily] = useState<DeviceFamily>("generic");
  const [overrides, setOverrides] = useState<ControllerBinding[]>([]);

  // Registry + the live focused id + screen handlers live in refs so the
  // gamepad rAF loop reads current values without re-subscribing each render.
  const entriesRef = useRef<Map<string, FocusEntry>>(new Map());
  const focusedRef = useRef<string | null>(null);
  const handlersRef = useRef<ActionHandlers>({});
  focusedRef.current = focusedId;

  const setFocus = useCallback((id: string | null) => setFocusedId(id), []);

  const register = useCallback((entry: FocusEntry) => {
    entriesRef.current.set(entry.id, entry);
    // First focusable to appear claims focus so a freshly-mounted screen is
    // immediately controller-operable with no pointer.
    setFocusedId((cur) => cur ?? entry.id);
    return () => {
      entriesRef.current.delete(entry.id);
      setFocusedId((cur) => (cur === entry.id ? null : cur));
    };
  }, []);

  const setActionHandlers = useCallback((h: ActionHandlers) => {
    handlersRef.current = h;
  }, []);

  // Load persisted binding overrides once (best-effort; defaults work without them).
  useEffect(() => {
    let cancelled = false;
    listBindings()
      .then((rows) => {
        if (!cancelled) setOverrides(rows);
      })
      .catch(() => {
        /* No DB / not in Tauri — compiled-in family defaults still apply. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAction = useCallback((action: SemanticAction) => {
    const dir = navDirection(action);
    if (dir) {
      const next = nextFocus(readTargets(entriesRef.current), focusedRef.current, dir);
      if (next) setFocusedId(next);
      return;
    }
    if (action === "confirm") {
      const entry = focusedRef.current ? entriesRef.current.get(focusedRef.current) : undefined;
      entry?.onActivate?.();
      return;
    }
    // back / menu / quit dispatch to the active screen's registered handler.
    handlersRef.current[action]?.();
  }, []);

  useGamepadPoll({ onAction: handleAction, overrides, onFamilyChange: setFamily });

  const value = useMemo<ControllerContextValue>(
    () => ({ focusedId, setFocus, register, family, setActionHandlers }),
    [focusedId, setFocus, register, family, setActionHandlers],
  );

  return <ControllerContext.Provider value={value}>{children}</ControllerContext.Provider>;
}

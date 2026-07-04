// Controller context + provider (W14, controller-input-design.md §3). Owns the
// single focus target, a registry of focusable elements, the live device family,
// and the persisted-bindings cache. Wires `useGamepadPoll` so D-pad/stick moves
// focus spatially, `confirm` activates the focused element, and `back`/`menu`
// dispatch to the active screen's registered handlers. Screens consume this via
// the `useFocusable` and `useController` hooks (see hooks.ts).
//
// `refreshBindings` (W267, controller-input-design.md §Remapping UI) re-fetches
// the persisted overrides on demand, so the Settings → Controllers binding
// editor can apply a rebind/reset live in nav without a restart.

import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DeviceFamily, SemanticAction } from "./actions";
import { listBindings, type ControllerBinding } from "../../ipc/controllers";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { ExclusiveClaimStack, type ExclusiveOwnerKind } from "./exclusiveStack";
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
  /**
   * Re-assert native DOM focus on a registered focusable's element (W275).
   * The focus-mirroring effects (`if (isFocused) ref.focus()`) only fire when
   * `isFocused` CHANGES, so a surface that stole/blurred DOM focus and went
   * away (the TV takeover) needs this to land keyboard focus back on the
   * unchanged controller-focused element. No-op for an unknown id.
   */
  focusElement: (id: string) => void;
  /** Register a focusable; returns an unregister cleanup. */
  register: (entry: FocusEntry) => () => void;
  /** The active controller's device family (drives HintBar glyphs). */
  family: DeviceFamily;
  /** Register screen-level handlers for non-focus actions (back/menu/quit). */
  setActionHandlers: (handlers: ActionHandlers) => void;
  /**
   * Claim the controller's exclusive slot: the handler receives EVERY semantic
   * action and bypasses spatial nav + screen handlers entirely. Claims stack
   * (v0.27 W275, exclusiveStack.ts): the LAST live claim wins, and the
   * returned release (idempotent — safe as an effect cleanup) uncovers the
   * claim beneath it rather than emptying the slot, so an unmounting/swapping
   * owner can never open a no-owner window in which actions leak to the base
   * engine. `kind` distinguishes UI surfaces (the TV home, the takeover
   * fallback — default) from gameplay owners (a mounted player whose gamepad
   * belongs to the game); see `gameplayClaimActive`.
   */
  claimExclusive: (
    handler: (action: SemanticAction) => void,
    kind?: ExclusiveOwnerKind,
  ) => () => void;
  /**
   * True while any live exclusive claim is a GAMEPLAY owner. App-level
   * affordances that must stay quiet during gameplay (the `menu` long-press
   * TV-mode toggle reads its own raw gamepad poll, so the exclusive slot alone
   * cannot gate it) key off this instead of guessing from the slot's state.
   */
  gameplayClaimActive: boolean;
  /**
   * The persisted per-family binding overrides (W267), exposed so secondary
   * raw-gamepad consumers (useLongPress) resolve the SAME effective bindings
   * as the main poll — a rebound `menu` must move the long-press with it.
   */
  bindingOverrides: readonly ControllerBinding[];
  /**
   * Re-fetch persisted binding overrides from the DB and apply them live. Call
   * after a rebind/reset (W267) so nav picks up the change immediately, with no
   * restart required. Best-effort: a failed re-fetch leaves the previous
   * overrides in place rather than throwing.
   */
  refreshBindings: () => Promise<void>;
  /**
   * Feed one semantic action through the SAME dispatch path
   * `useGamepadPoll`'s rising-edge detection drives (W283,
   * controller-input-design.md §Keyboard as an input method): exclusive-claim
   * routing first, then spatial nav / confirm / screen handlers. Additive —
   * this is how the keyboard bridge (`useKeyboardNav`) reaches every surface
   * without a second, parallel routing implementation, and without the
   * gamepad's own binding resolution/rising-edge logic (`resolveBindings`,
   * `risingActions`) changing in any way.
   */
  dispatchAction: (action: SemanticAction) => void;
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
  // Layered exclusive-slot ownership (W275) — the rAF loop dispatches to the
  // stack's TOP claim; the pure stack lives in a ref like the other loop state.
  const exclusiveStackRef = useRef(new ExclusiveClaimStack<(action: SemanticAction) => void>());
  const [gameplayClaimActive, setGameplayClaimActive] = useState(false);
  focusedRef.current = focusedId;

  const setFocus = useCallback((id: string | null) => setFocusedId(id), []);

  const focusElement = useCallback((id: string) => {
    entriesRef.current.get(id)?.el.focus();
  }, []);

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

  const claimExclusive = useCallback(
    (handler: (action: SemanticAction) => void, kind: ExclusiveOwnerKind = "ui") => {
      const release = exclusiveStackRef.current.claim(handler, kind);
      setGameplayClaimActive(exclusiveStackRef.current.hasGameplayClaim());
      return () => {
        release();
        setGameplayClaimActive(exclusiveStackRef.current.hasGameplayClaim());
      };
    },
    [],
  );

  // Load persisted binding overrides once (best-effort; defaults work without them).
  useCancellableEffect((isCancelled) => {
    listBindings()
      .then((rows) => {
        if (!isCancelled()) setOverrides(rows);
      })
      .catch(() => {
        /* No DB / not in Tauri — compiled-in family defaults still apply. */
      });
  }, []);

  // Re-fetch on demand (W267): the binding editor calls this after a
  // rebind/reset so the effective bindings update live, with no restart.
  const refreshBindings = useCallback(async () => {
    try {
      const rows = await listBindings();
      setOverrides(rows);
    } catch {
      /* Keep the previous overrides; defaults still apply. */
    }
  }, []);

  const handleAction = useCallback((action: SemanticAction) => {
    // An exclusive owner (modal/immersive surface) swallows every action; the
    // top of the claim stack is the current owner (W275).
    const exclusive = exclusiveStackRef.current.top();
    if (exclusive) {
      exclusive(action);
      return;
    }
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
    () => ({
      focusedId,
      setFocus,
      focusElement,
      register,
      family,
      setActionHandlers,
      claimExclusive,
      gameplayClaimActive,
      bindingOverrides: overrides,
      refreshBindings,
      dispatchAction: handleAction,
    }),
    [
      focusedId,
      setFocus,
      focusElement,
      register,
      family,
      setActionHandlers,
      claimExclusive,
      gameplayClaimActive,
      overrides,
      refreshBindings,
      handleAction,
    ],
  );

  return <ControllerContext.Provider value={value}>{children}</ControllerContext.Provider>;
}

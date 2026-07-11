// ControllersPane — Settings → Controllers (W267, replaces the W14 stub).
//
// A press-to-rebind editor: one section per device family, each a table of
// semantic actions showing the bound button (family-appropriate glyph/label).
// Clicking/activating a row enters capture mode ("press a button…"), which
// listens to the raw Gamepad API for the next button press on any connected
// pad of that family (Escape or a timeout cancels). A capture that collides
// with an existing binding surfaces a swap/clear choice (pure logic in
// ../remap.ts). Persists via the bindings IPC and calls the controller
// context's `refreshBindings()` so nav picks up the change live, with no
// restart. The pane itself is controller-navigable: every row registers with
// `useFocusable`, and capture mode takes exclusive input while active.

import { useCallback, useEffect, useState } from "react";
import { AuraButton } from "@aura/react";

import {
  DEVICE_FAMILIES,
  detectFamily,
  glyphFor,
  resolveBindings,
  useController,
  useFocusable,
  type BindingMap,
  type DeviceFamily,
  type SemanticAction,
} from "../../controller";
import { listBindings, resetBindings, setBinding, type ControllerBinding } from "../../../ipc/controllers";
import {
  ACTION_LABEL,
  CAPTURE_TIMEOUT_MS,
  FAMILY_LABEL,
  UNBOUND,
  applyRebind,
  bindingRows,
  buttonDisplayLabel,
  diffBindings,
  findConflict,
  type ConflictResolution,
} from "../remap";
import "./controllers-pane.css";

/** In-progress capture: which family/action is being rebound. */
interface CaptureState {
  family: DeviceFamily;
  action: SemanticAction;
}

/** A pending swap/clear decision after a capture collided with another action. */
interface ConflictState {
  family: DeviceFamily;
  action: SemanticAction;
  buttonIndex: number;
  conflictAction: SemanticAction;
}

/**
 * Poll every connected gamepad for a fresh (rising-edge) button press on a pad
 * of `family`, invoking `onPress` with the first one found. Returns a cancel
 * function the caller must invoke on cleanup/timeout/Escape to stop the rAF
 * loop — this is capture mode's only impure surface; the rebind/merge logic it
 * drives lives in the pure `remap.ts` module.
 */
function pollForPress(family: DeviceFamily, onPress: (buttonIndex: number) => void): () => void {
  let cancelled = false;
  let raf = 0;
  const prevPressed = new Map<number, Set<number>>(); // pad index -> pressed button indices

  const tick = () => {
    if (cancelled) return;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || detectFamily(pad.id) !== family) continue;
      const prev = prevPressed.get(i) ?? new Set<number>();
      const now = new Set<number>();
      pad.buttons.forEach((b, idx) => {
        if (b.pressed) now.add(idx);
      });
      for (const idx of now) {
        if (!prev.has(idx)) {
          onPress(idx);
          return; // caller decides what happens next; stop this poll.
        }
      }
      prevPressed.set(i, now);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/** One controller-focusable row: shows the glyph/label and enters capture mode on activate. */
function RebindRow({
  family,
  action,
  buttonIndex,
  onCapture,
}: {
  family: DeviceFamily;
  action: SemanticAction;
  buttonIndex: number;
  onCapture: (family: DeviceFamily, action: SemanticAction) => void;
}) {
  const { ref, isFocused, focus } = useFocusable<HTMLButtonElement>(
    `controller-remap:${family}:${action}`,
    () => onCapture(family, action),
  );
  const glyph = buttonIndex === UNBOUND ? null : glyphFor(family, action);
  const label = buttonDisplayLabel(buttonIndex);

  return (
    <div role="row">
      <button
        ref={ref}
        type="button"
        tabIndex={0}
        className={`rgp-remap-row${isFocused ? " rgp-remap-row--focused" : ""}`}
        onFocus={focus}
        onClick={() => onCapture(family, action)}
      >
        <span className="rgp-remap-row__action" role="cell">
          {ACTION_LABEL[action]}
        </span>
        <span
          className={`rgp-remap-row__button${buttonIndex === UNBOUND ? " rgp-remap-row__button--unbound" : ""}`}
          role="cell"
        >
          {glyph && (
            <span className="rgp-remap-row__button-glyph" aria-hidden>
              {glyph.glyph}
            </span>
          )}
          {label}
        </span>
      </button>
    </div>
  );
}

/** One family's rebind table + its Reset-to-defaults action. */
function FamilySection({
  family,
  overrides,
  onCapture,
  onReset,
}: {
  family: DeviceFamily;
  overrides: ReadonlyArray<{ action: string; button: string }>;
  onCapture: (family: DeviceFamily, action: SemanticAction) => void;
  onReset: (family: DeviceFamily) => void;
}) {
  const bindings = resolveBindings(family, overrides);
  const rows = bindingRows(bindings);

  return (
    <section
      className="rgp-panel"
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 8 }}
      aria-label={`${FAMILY_LABEL[family]} bindings`}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>{FAMILY_LABEL[family]}</h4>
        <AuraButton tabIndex={0} variant="ghost" onClick={() => onReset(family)}>
          Reset to defaults
        </AuraButton>
      </div>

      <div
        role="table"
        aria-label={`${FAMILY_LABEL[family]} action bindings`}
        style={{ display: "flex", flexDirection: "column", gap: 4 }}
      >
        {rows.map((row) => (
          <RebindRow
            key={row.action}
            family={family}
            action={row.action}
            buttonIndex={row.buttonIndex}
            onCapture={onCapture}
          />
        ))}
      </div>
    </section>
  );
}

export function ControllersPane() {
  const { refreshBindings } = useController();
  const [overrides, setOverrides] = useState<ControllerBinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const load = useCallback(() => {
    listBindings()
      .then(setOverrides)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const overridesFor = useCallback(
    (family: DeviceFamily) => overrides.filter((o) => o.deviceFamily === family),
    [overrides],
  );

  /** Persist the diff between two binding maps for one family, then refresh live. */
  const persist = useCallback(
    async (family: DeviceFamily, from: BindingMap, to: BindingMap) => {
      const changed = diffBindings(from, to);
      try {
        for (const row of changed) {
          await setBinding(family, row.action, row.button);
        }
        setError(null);
        load();
        await refreshBindings();
      } catch (e: unknown) {
        setError(String(e));
      }
    },
    [load, refreshBindings],
  );

  const finishCapture = useCallback(
    (family: DeviceFamily, action: SemanticAction, buttonIndex: number) => {
      setCapture(null);
      const bindings = resolveBindings(family, overridesFor(family));
      const conflictAction = findConflict(bindings, action, buttonIndex);
      if (conflictAction) {
        setConflict({ family, action, buttonIndex, conflictAction });
        return;
      }
      const next = applyRebind(bindings, action, buttonIndex);
      void persist(family, bindings, next);
    },
    [overridesFor, persist],
  );

  // Drive the capture-mode gamepad poll + keyboard Escape + timeout. Capture
  // mode takes exclusive input: Escape is captured at the window level and the
  // gamepad poll bypasses the shared ControllerProvider/spatial-nav loop
  // entirely (it reads navigator.getGamepads() directly), so nav/confirm stay
  // silent while a rebind is pending.
  useEffect(() => {
    if (!capture) return;
    const { family, action } = capture;

    const stopPoll = pollForPress(family, (buttonIndex) => finishCapture(family, action, buttonIndex));

    const timeout = window.setTimeout(() => setCapture(null), CAPTURE_TIMEOUT_MS);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCapture(null);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      stopPoll();
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [capture, finishCapture]);

  function resolveConflict(resolution: ConflictResolution) {
    if (!conflict) return;
    const { family, action, buttonIndex } = conflict;
    const bindings = resolveBindings(family, overridesFor(family));
    const next = applyRebind(bindings, action, buttonIndex, resolution);
    setConflict(null);
    void persist(family, bindings, next);
  }

  async function handleReset(family: DeviceFamily) {
    try {
      await resetBindings(family);
      setError(null);
      load();
      await refreshBindings();
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Controller Bindings</h3>
      <p style={{ color: "var(--aura-on-surface-muted)", margin: 0, fontSize: 13 }}>
        Click or activate an action to rebind it — press any button on a
        connected pad of that family. Escape cancels; capture also times out
        automatically.
      </p>

      {error && <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>{error}</p>}

      {DEVICE_FAMILIES.map((family) => (
        <FamilySection
          key={family}
          family={family}
          overrides={overridesFor(family)}
          onCapture={(fam, action) => setCapture({ family: fam, action })}
          onReset={handleReset}
        />
      ))}

      {capture && (
        <div className="rgp-remap-capture" role="dialog" aria-modal="true" aria-label="Press a button">
          <div className="rgp-remap-capture__card">
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              Press a button for {ACTION_LABEL[capture.action]}…
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
              {FAMILY_LABEL[capture.family]} — Escape to cancel
            </p>
            <AuraButton tabIndex={0} variant="ghost" onClick={() => setCapture(null)}>
              Cancel
            </AuraButton>
          </div>
        </div>
      )}

      {conflict && (
        <div className="rgp-remap-capture" role="dialog" aria-modal="true" aria-label="Binding conflict">
          <div className="rgp-remap-capture__card">
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {buttonDisplayLabel(conflict.buttonIndex)} is already bound to{" "}
              {ACTION_LABEL[conflict.conflictAction]}.
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
              Swap the two bindings, or clear {ACTION_LABEL[conflict.conflictAction]}?
            </p>
            <div className="rgp-remap-conflict__actions">
              <AuraButton tabIndex={0} variant="secondary" onClick={() => resolveConflict("swap")}>
                Swap
              </AuraButton>
              <AuraButton tabIndex={0} variant="danger" onClick={() => resolveConflict("clear")}>
                Clear {ACTION_LABEL[conflict.conflictAction]}
              </AuraButton>
              <AuraButton tabIndex={0} variant="ghost" onClick={() => setConflict(null)}>
                Cancel
              </AuraButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useController } from "../controller/hooks";

/** Test-only helper: exposes the current `ControllerProvider`'s
 * `dispatchAction`/`setFocus` on `window` so a test can drive controller
 * actions/focus directly without simulating real input. Mount inside a
 * `<ControllerProvider>` alongside the component under test. */
export function DispatchProbe() {
  const { dispatchAction, setFocus } = useController();
  const probe = window as unknown as {
    __dispatchAction: typeof dispatchAction;
    __setFocus: typeof setFocus;
  };
  probe.__dispatchAction = dispatchAction;
  probe.__setFocus = setFocus;
  return null;
}

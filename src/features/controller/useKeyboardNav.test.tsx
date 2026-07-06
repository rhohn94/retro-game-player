// Render tests for useKeyboardNav (issue #34 §2, W283 follow-up): the impure
// window-level keydown bridge. Only the pure classification (keyboardMap.ts)
// had coverage; this suite drives the hook itself with real DOM keydown
// events, mirroring `ErrorBoundary.test.tsx`'s bare createRoot + act() harness
// (no testing-library dependency) since it needs a real DOM to mount a
// function component that calls the hook.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardNav } from "./useKeyboardNav";
import type { SemanticAction } from "./actions";

// Tells React this file's DOM mutations are wrapped in `act()` (they are,
// throughout this suite) — silences the "not configured to support act"
// warning that otherwise fires because this repo has no global test-setup
// file flipping this on (unlike a testing-library preset, which sets it for
// free).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mounts a component that installs the hook with the given options, so each
 * test can dispatch real `keydown` events at `window` and assert on the
 * `dispatchAction` spy. */
function Harness({
  dispatchAction,
  enabled,
}: {
  dispatchAction: (action: SemanticAction) => void;
  enabled?: boolean;
}) {
  useKeyboardNav({ dispatchAction, enabled });
  return null;
}

function dispatch(target: EventTarget, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  return target.dispatchEvent(event);
}

describe("useKeyboardNav", () => {
  let container: HTMLDivElement;
  let root: Root;
  let dispatchAction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchAction = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function mount(opts?: { enabled?: boolean }) {
    act(() => {
      root.render(<Harness dispatchAction={dispatchAction} enabled={opts?.enabled} />);
    });
  }

  it("dispatches a semantic action for a bridged key on window", () => {
    mount();
    act(() => {
      dispatch(window, { key: "ArrowDown" });
    });
    expect(dispatchAction).toHaveBeenCalledWith("nav_down");
  });

  it("does nothing for a key with no semantic mapping", () => {
    mount();
    act(() => {
      dispatch(window, { key: "a" });
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it("respects a key already defaultPrevented by a local handler", () => {
    mount();
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowUp" });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it("preventDefault()s the event when it dispatches an action", () => {
    mount();
    let prevented = false;
    act(() => {
      prevented = !dispatch(window, { key: "Enter" });
    });
    expect(prevented).toBe(true);
    expect(dispatchAction).toHaveBeenCalledWith("confirm");
  });

  it("does not install a listener at all when disabled", () => {
    mount({ enabled: false });
    act(() => {
      dispatch(window, { key: "ArrowDown" });
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it("yields to a native control target (input) for a bridged non-Escape key", () => {
    mount();
    const input = document.createElement("input");
    container.appendChild(input);
    act(() => {
      dispatch(input, { key: "ArrowDown" });
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it("still dispatches Escape (back) even when the target is a native control", () => {
    mount();
    const input = document.createElement("input");
    container.appendChild(input);
    act(() => {
      dispatch(input, { key: "Escape" });
    });
    expect(dispatchAction).toHaveBeenCalledWith("back");
  });

  it("yields to a native activation target (a real button) for confirm", () => {
    mount();
    const button = document.createElement("button");
    container.appendChild(button);
    act(() => {
      dispatch(button, { key: "Enter" });
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it("still dispatches confirm for a DISABLED native activation target", () => {
    mount();
    const button = document.createElement("button");
    button.disabled = true;
    container.appendChild(button);
    act(() => {
      dispatch(button, { key: "Enter" });
    });
    expect(dispatchAction).toHaveBeenCalledWith("confirm");
  });

  it("removes its listener on unmount", () => {
    mount();
    act(() => root.unmount());
    act(() => {
      dispatch(window, { key: "ArrowDown" });
    });
    expect(dispatchAction).not.toHaveBeenCalled();
    // Re-create the root so the shared afterEach's unmount stays a no-op.
    root = createRoot(container);
  });
});

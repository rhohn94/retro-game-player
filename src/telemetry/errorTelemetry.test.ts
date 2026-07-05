// Unit tests for the frontend unhandled-error sink (W360). Runs in vitest's
// plain node environment — `installGlobalErrorHandlers` takes an injectable
// `target` so these tests exercise the real handler functions without
// needing a real `window`/jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecordedFrontendErrors,
  getRecordedFrontendErrors,
  installGlobalErrorHandlers,
  recordFrontendError,
} from "./errorTelemetry";

/** Minimal fake of the window surface `installGlobalErrorHandlers` needs. */
function fakeWindow() {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    onerror: null as OnErrorEventHandler,
    addEventListener(type: string, listener: (event: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    dispatch(type: string, event: unknown) {
      for (const l of listeners[type] ?? []) l(event);
    },
  };
}

describe("recordFrontendError", () => {
  beforeEach(() => {
    clearRecordedFrontendErrors();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("records source, message, detail, and a timestamp", () => {
    const record = recordFrontendError("react-error-boundary", "boom", "extra detail");
    expect(record.source).toBe("react-error-boundary");
    expect(record.message).toBe("boom");
    expect(record.detail).toBe("extra detail");
    expect(record.occurredAt).toBeGreaterThan(0);
    expect(getRecordedFrontendErrors()).toEqual([record]);
  });

  it("logs through console.error with a stable [telemetry] prefix", () => {
    recordFrontendError("window.onerror", "boom");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry] window.onerror: boom"),
      "",
    );
  });

  it("caps the ring buffer at 50 records", () => {
    for (let i = 0; i < 60; i++) recordFrontendError("unhandledrejection", `err-${i}`);
    const all = getRecordedFrontendErrors();
    expect(all).toHaveLength(50);
    expect(all[0]?.message).toBe("err-10");
    expect(all.at(-1)?.message).toBe("err-59");
  });
});

describe("installGlobalErrorHandlers", () => {
  beforeEach(() => {
    clearRecordedFrontendErrors();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("a thrown error reaches window.onerror and is recorded", () => {
    const win = fakeWindow();
    installGlobalErrorHandlers(win as unknown as Window);

    const thrown = new Error("thrown in a handler");
    win.onerror?.("message ignored when error present", "app.tsx", 10, 5, thrown);

    const all = getRecordedFrontendErrors();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ source: "window.onerror", message: "thrown in a handler" });
  });

  it("a rejected promise reaches the unhandledrejection handler and is recorded", () => {
    const win = fakeWindow();
    installGlobalErrorHandlers(win as unknown as Window);

    win.dispatch("unhandledrejection", { reason: new Error("promise rejected") });

    const all = getRecordedFrontendErrors();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      source: "unhandledrejection",
      message: "promise rejected",
    });
  });

  it("a rejected promise with a non-Error reason is stringified", () => {
    const win = fakeWindow();
    installGlobalErrorHandlers(win as unknown as Window);

    win.dispatch("unhandledrejection", { reason: "plain string reason" });

    expect(getRecordedFrontendErrors()[0]?.message).toBe("plain string reason");
  });
});

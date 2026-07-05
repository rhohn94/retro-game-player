// Render test for ErrorBoundary (W360, error-telemetry-design.md). Runs
// under jsdom (see vitest.config.ts's environmentMatchGlobs) since it needs a
// real DOM to mount React via `react-dom/client`. No testing-library
// dependency — a plain createRoot mount + act() is enough to prove the
// fallback shows instead of a white screen.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { clearRecordedFrontendErrors, getRecordedFrontendErrors } from "../telemetry/errorTelemetry";

function ThrowingChild(): never {
  throw new Error("render blew up");
}

function Fine() {
  return <div data-testid="fine">all good</div>;
}

describe("ErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearRecordedFrontendErrors();
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders children normally when nothing throws", () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Fine />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("all good");
  });

  it("shows the fallback instead of a blank tree when a child throws", () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>,
      );
    });

    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).toContain("render blew up");
    // Not a blank/unmounted tree: the fallback actually rendered content.
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("records the error through the frontend telemetry sink", () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>,
      );
    });

    const [record] = getRecordedFrontendErrors();
    expect(record).toMatchObject({ source: "react-error-boundary", message: "render blew up" });
  });
});

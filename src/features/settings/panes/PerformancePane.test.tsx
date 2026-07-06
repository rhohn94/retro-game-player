// Render test for PerformancePane (v0.38 W381, closes #35). Mirrors
// RetroAchievementsPane.test.tsx's bare createRoot + act() harness (no
// testing-library dependency). Mocks ipc/perf-tools directly so the test
// exercises the pane's own state wiring for all three sections — including
// the new "GPU draw cost" section this item adds, proving the panel actually
// reads back the sibling log the frontend now reports to (not just that the
// IPC binding exists).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readNativePerfLog = vi.fn();
const readEjsPerfLog = vi.fn();
const readDrawCostLog = vi.fn();

vi.mock("../../../ipc/perf-tools", () => ({
  readNativePerfLog: (...args: unknown[]) => readNativePerfLog(...args),
  readEjsPerfLog: (...args: unknown[]) => readEjsPerfLog(...args),
  readDrawCostLog: (...args: unknown[]) => readDrawCostLog(...args),
}));

const { PerformancePane } = await import("./PerformancePane");

describe("PerformancePane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    readNativePerfLog.mockReset();
    readEjsPerfLog.mockReset();
    readDrawCostLog.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("shows the empty hint for the GPU draw-cost section on a fresh install", async () => {
    readNativePerfLog.mockResolvedValue({ lines: [], fpsSeries: [] });
    readEjsPerfLog.mockResolvedValue({ lines: [], fpsSeries: [] });
    readDrawCostLog.mockResolvedValue({ lines: [], fpsSeries: [] });

    await act(async () => {
      root.render(<PerformancePane />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readDrawCostLog).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("GPU draw cost");
    expect(container.textContent).toContain("No timer-query samples recorded yet");
  });

  it("renders resolved draw-cost samples as raw lines without a misleading fps sparkline", async () => {
    readNativePerfLog.mockResolvedValue({ lines: [], fpsSeries: [] });
    readEjsPerfLog.mockResolvedValue({ lines: [], fpsSeries: [] });
    readDrawCostLog.mockResolvedValue({
      lines: [
        "[rgp-draw-cost] perf: 1.500 ms draw cost",
        "[rgp-draw-cost] perf: 2.250 ms draw cost",
      ],
      fpsSeries: [null, null],
    });

    await act(async () => {
      root.render(<PerformancePane />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("1.500 ms draw cost");
    expect(container.textContent).toContain("2.250 ms draw cost");
    // showSparkline={false} for this section — no sparkline svg should render
    // scoped to the draw-cost table's section.
    const table = container.querySelector('[data-testid="perf-table-GPU draw cost"]');
    expect(table).not.toBeNull();
    const section = table?.closest(".rgp-perf-pane__section");
    expect(section?.querySelector("svg")).toBeNull();
  });

  it("surfaces a read error for the draw-cost section independently of the other two", async () => {
    readNativePerfLog.mockResolvedValue({ lines: [], fpsSeries: [] });
    readEjsPerfLog.mockResolvedValue({ lines: [], fpsSeries: [] });
    readDrawCostLog.mockRejectedValue(new Error("boom"));

    await act(async () => {
      root.render(<PerformancePane />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("boom");
    // The other two sections still render their (empty) hints, unaffected.
    expect(container.textContent).toContain("No native-play sessions recorded yet");
    expect(container.textContent).toContain("No in-page sessions recorded yet");
  });
});

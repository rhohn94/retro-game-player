// Render tests for AchievementBadge (v0.38 W384): renders the resolved badge
// image, degrades to a placeholder glyph when the IPC seam resolves `null`
// (offline / unavailable), and re-resolves per badge name. The "cache-hit on
// second render" acceptance criterion is exercised at this IPC seam (mocked
// here) — the actual disk-cache hit/miss behavior lives in the Rust-side
// `resolve_badge_path` tests (src-tauri/src/commands/achievements.rs).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AchievementBadge } from "./AchievementBadge";

const getAchievementBadgePath = vi.fn();
vi.mock("../../ipc/retroachievements", () => ({
  getAchievementBadgePath: (...args: unknown[]) => getAchievementBadgePath(...args),
}));

// `artUrl` (art.ts) funnels a resolved path through Tauri's `convertFileSrc`,
// which throws outside a real Tauri webview (jsdom has none) — stub it so a
// resolved badge path actually renders as an <img> here, matching how every
// other on-disk-art component in this app is exercised under jsdom.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

describe("AchievementBadge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the placeholder glyph immediately, before the badge path resolves", async () => {
    getAchievementBadgePath.mockImplementation(() => new Promise(() => undefined)); // never resolves
    await act(async () => {
      root.render(<AchievementBadge badgeName="111" unlocked={true} />);
    });
    const badge = container.querySelector(".rgp-achievement-badge");
    expect(badge!.tagName).toBe("SPAN");
  });

  it("renders an <img> once the badge path resolves (a cache hit or a fresh fetch)", async () => {
    getAchievementBadgePath.mockResolvedValue("/cache/retroachievements-badges/111.png");
    await act(async () => {
      root.render(<AchievementBadge badgeName="111" unlocked={true} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const badge = container.querySelector(".rgp-achievement-badge") as HTMLImageElement | null;
    expect(badge).not.toBeNull();
    expect(badge!.tagName).toBe("IMG");
  });

  it("degrades to the placeholder glyph when the badge is unavailable (offline / unrecognized)", async () => {
    getAchievementBadgePath.mockResolvedValue(null);
    await act(async () => {
      root.render(<AchievementBadge badgeName="111" unlocked={true} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const badge = container.querySelector(".rgp-achievement-badge");
    expect(badge!.tagName).toBe("SPAN");
  });

  it("never calls the badge-path IPC when there is no badge name at all", async () => {
    await act(async () => {
      root.render(<AchievementBadge badgeName={null} unlocked={false} />);
      await Promise.resolve();
    });
    expect(getAchievementBadgePath).not.toHaveBeenCalled();
    expect(container.querySelector(".rgp-achievement-badge")!.tagName).toBe("SPAN");
  });

  it("applies the locked modifier class only when unlocked is false", async () => {
    getAchievementBadgePath.mockResolvedValue(null);
    await act(async () => {
      root.render(<AchievementBadge badgeName={null} unlocked={false} />);
    });
    expect(container.querySelector(".rgp-achievement-badge")!.className).toContain(
      "rgp-achievement-badge--locked",
    );
  });

  it("re-resolves when the badge name changes", async () => {
    getAchievementBadgePath.mockResolvedValueOnce("/cache/111.png").mockResolvedValueOnce("/cache/222.png");
    await act(async () => {
      root.render(<AchievementBadge badgeName="111" unlocked={true} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<AchievementBadge badgeName="222" unlocked={true} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getAchievementBadgePath).toHaveBeenCalledWith("111");
    expect(getAchievementBadgePath).toHaveBeenCalledWith("222");
  });
});

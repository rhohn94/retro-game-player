// Render tests for AchievementList (v0.38 W384): unlocked/locked/empty
// states, from fixture entries. Runs under jsdom via a plain createRoot +
// act() mount, mirroring CollectionPicker.test.tsx — no testing-library
// dependency. `../../ipc/retroachievements`'s badge-path call (made by the
// nested AchievementBadge) is mocked so no real Tauri invoke is needed.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AchievementList } from "./AchievementList";
import type { AchievementListEntry } from "../../ipc/retroachievements";

const getAchievementBadgePath = vi.fn();
vi.mock("../../ipc/retroachievements", () => ({
  getAchievementBadgePath: (...args: unknown[]) => getAchievementBadgePath(...args),
}));

function entry(overrides: Partial<AchievementListEntry> = {}): AchievementListEntry {
  return {
    id: 1,
    title: "First Steps",
    description: "Do the thing",
    points: 10,
    badgeName: null,
    unlockedAt: null,
    ...overrides,
  };
}

describe("AchievementList", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    getAchievementBadgePath.mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing when the entry list is empty (unconfigured / no cached set)", async () => {
    await act(async () => {
      root.render(<AchievementList entries={[]} open={true} />);
    });
    expect(container.querySelector(".rgp-achievement-list")).toBeNull();
  });

  it("renders nothing while collapsed, even with entries present", async () => {
    await act(async () => {
      root.render(<AchievementList entries={[entry()]} open={false} />);
    });
    expect(container.querySelector(".rgp-achievement-list")).toBeNull();
  });

  it("renders a locked entry dimmed, with its point value and no unlock date", async () => {
    await act(async () => {
      root.render(<AchievementList entries={[entry({ points: 25 })]} open={true} />);
    });
    const item = container.querySelector(".rgp-achievement-list__item");
    expect(item).not.toBeNull();
    expect(item!.className).toContain("rgp-achievement-list__item--locked");
    expect(item!.textContent).toContain("25 pts");
    expect(container.querySelector(".rgp-achievement-list__unlocked-at")).toBeNull();
  });

  it("renders an unlocked entry distinctly, with its unlock date shown", async () => {
    await act(async () => {
      root.render(
        <AchievementList entries={[entry({ unlockedAt: 1_700_000_000 })]} open={true} />,
      );
    });
    const item = container.querySelector(".rgp-achievement-list__item");
    expect(item).not.toBeNull();
    expect(item!.className).toContain("rgp-achievement-list__item--unlocked");
    expect(container.querySelector(".rgp-achievement-list__unlocked-at")).not.toBeNull();
  });

  it("renders every entry it's given, in the order provided", async () => {
    await act(async () => {
      root.render(
        <AchievementList
          entries={[
            entry({ id: 1, title: "Unlocked One", unlockedAt: 100 }),
            entry({ id: 2, title: "Locked Two", unlockedAt: null }),
          ]}
          open={true}
        />,
      );
    });
    const titles = Array.from(container.querySelectorAll(".rgp-achievement-list__title")).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["Unlocked One", "Locked Two"]);
  });

  it("renders fully without any badge art (placeholder glyph, no network wait)", async () => {
    getAchievementBadgePath.mockResolvedValue(null);
    await act(async () => {
      root.render(<AchievementList entries={[entry({ badgeName: "111" })]} open={true} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const badge = container.querySelector(".rgp-achievement-badge");
    expect(badge).not.toBeNull();
    expect(badge!.tagName).toBe("SPAN"); // placeholder glyph, not an <img>
  });
});

// Unit tests for the TV takeover transition state machine (W265). Covers the
// reveal contract (expand → reveal-on-surface-exists → collapse), the
// reduced-motion plain-crossfade path, and the idempotency guards that let the
// reveal/collapse triggers fire more than once safely.

import { describe, expect, it } from "vitest";
import {
  IDLE_TAKEOVER,
  beginCollapse,
  beginTakeover,
  isCoverVisible,
  isPlayerUncovered,
  isTakeoverActive,
  revealPlayer,
  type TileRect,
} from "./tvTakeover";

const RECT: TileRect = { top: 100, left: 200, width: 320, height: 440 };

describe("beginTakeover", () => {
  it("enters `expanding` with motion, carrying the game id + origin rect", () => {
    const s = beginTakeover(7, RECT, false);
    expect(s.phase).toBe("expanding");
    expect(s.gameId).toBe(7);
    expect(s.originRect).toEqual(RECT);
  });

  it("jumps straight to `revealed` under reduced motion (plain crossfade)", () => {
    const s = beginTakeover(7, RECT, true);
    expect(s.phase).toBe("revealed");
    expect(s.gameId).toBe(7);
  });

  it("accepts a null origin rect (centred fallback)", () => {
    const s = beginTakeover(3, null, false);
    expect(s.phase).toBe("expanding");
    expect(s.originRect).toBeNull();
  });
});

describe("revealPlayer", () => {
  it("advances an expanding takeover to revealed", () => {
    const s = revealPlayer(beginTakeover(1, RECT, false));
    expect(s.phase).toBe("revealed");
  });

  it("is idempotent — revealing again is a no-op", () => {
    const once = revealPlayer(beginTakeover(1, RECT, false));
    const twice = revealPlayer(once);
    expect(twice).toBe(once); // same reference — no churn
  });

  it("never advances an idle or collapsing state", () => {
    expect(revealPlayer(IDLE_TAKEOVER)).toBe(IDLE_TAKEOVER);
    const collapsing = beginCollapse(beginTakeover(1, RECT, false));
    expect(revealPlayer(collapsing)).toBe(collapsing);
  });
});

describe("beginCollapse", () => {
  it("collapses a live (expanding) takeover", () => {
    const s = beginCollapse(beginTakeover(1, RECT, false));
    expect(s.phase).toBe("collapsing");
    expect(s.gameId).toBe(1); // still knows what it collapses from
    expect(s.originRect).toEqual(RECT); // collapses back to the same tile
  });

  it("collapses a revealed takeover", () => {
    const s = beginCollapse(revealPlayer(beginTakeover(1, RECT, false)));
    expect(s.phase).toBe("collapsing");
  });

  it("is a no-op on idle or already-collapsing (double-exit safe)", () => {
    expect(beginCollapse(IDLE_TAKEOVER)).toBe(IDLE_TAKEOVER);
    const collapsing = beginCollapse(beginTakeover(1, RECT, false));
    expect(beginCollapse(collapsing)).toBe(collapsing);
  });
});

describe("isTakeoverActive", () => {
  it("is false only when idle", () => {
    expect(isTakeoverActive(IDLE_TAKEOVER)).toBe(false);
    expect(isTakeoverActive(beginTakeover(1, RECT, false))).toBe(true);
    expect(isTakeoverActive(revealPlayer(beginTakeover(1, RECT, false)))).toBe(true);
    expect(isTakeoverActive(beginCollapse(beginTakeover(1, RECT, false)))).toBe(true);
  });
});

describe("isPlayerUncovered", () => {
  it("uncovers the player only while revealed (the game is playing)", () => {
    expect(isPlayerUncovered(IDLE_TAKEOVER)).toBe(false);
    expect(isPlayerUncovered(beginTakeover(1, RECT, false))).toBe(false); // still expanding
    expect(isPlayerUncovered(revealPlayer(beginTakeover(1, RECT, false)))).toBe(true);
    // Collapsing: the cover fades back OVER the player, so it is not "uncovered".
    const collapsing = beginCollapse(revealPlayer(beginTakeover(1, RECT, false)));
    expect(isPlayerUncovered(collapsing)).toBe(false);
  });

  it("under reduced motion the player is uncovered immediately", () => {
    expect(isPlayerUncovered(beginTakeover(1, RECT, true))).toBe(true);
  });
});

describe("isCoverVisible", () => {
  it("shows the cover while expanding and while collapsing, hidden once revealed", () => {
    expect(isCoverVisible(IDLE_TAKEOVER)).toBe(false);
    expect(isCoverVisible(beginTakeover(1, RECT, false))).toBe(true); // expanding
    expect(isCoverVisible(revealPlayer(beginTakeover(1, RECT, false)))).toBe(false); // revealed
    const collapsing = beginCollapse(revealPlayer(beginTakeover(1, RECT, false)));
    expect(isCoverVisible(collapsing)).toBe(true);
  });

  it("under reduced motion the cover is hidden immediately (plain crossfade)", () => {
    // beginTakeover with reducedMotion jumps to `revealed` — no expand, so the
    // cover never shows; the swap is carried by the player fading in.
    expect(isCoverVisible(beginTakeover(1, RECT, true))).toBe(false);
  });
});

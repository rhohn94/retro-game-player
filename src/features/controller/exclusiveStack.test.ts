// Unit tests for ExclusiveClaimStack (v0.27 W275) — the layered exclusive-slot
// ownership that closes the no-owner windows the single-ref slot left open
// (tv-mode-design.md §v0.27 → W275 audit: controller ownership during takeover
// boot / player swaps / GetCorePanel).

import { describe, expect, it } from "vitest";
import { ExclusiveClaimStack } from "./exclusiveStack";

type Handler = (action: string) => void;
const h = (): Handler => () => undefined;

describe("ExclusiveClaimStack", () => {
  it("starts empty with no owner", () => {
    const stack = new ExclusiveClaimStack<Handler>();
    expect(stack.top()).toBeNull();
    expect(stack.size).toBe(0);
    expect(stack.hasGameplayClaim()).toBe(false);
  });

  it("last claim wins", () => {
    const stack = new ExclusiveClaimStack<Handler>();
    const home = h();
    const player = h();
    stack.claim(home, "ui");
    stack.claim(player, "gameplay");
    expect(stack.top()).toBe(player);
  });

  it("releasing the top uncovers the claim beneath (the W275 handoff fix)", () => {
    const stack = new ExclusiveClaimStack<Handler>();
    const home = h();
    const fallback = h();
    const player = h();
    stack.claim(home, "ui");
    const releaseFallback = stack.claim(fallback, "ui");
    const releasePlayer = stack.claim(player, "gameplay");

    // Player unmounts (e.g. native start failed, swapping to the in-page
    // player): the surface fallback — not the base spatial engine — owns the
    // slot during the gap.
    releasePlayer();
    expect(stack.top()).toBe(fallback);

    // Surface unmounts: the home is back on top; never a null gap while
    // someone still claims.
    releaseFallback();
    expect(stack.top()).toBe(home);
  });

  it("releases by identity, so out-of-order releases never disturb the top", () => {
    const stack = new ExclusiveClaimStack<Handler>();
    const a = h();
    const b = h();
    const releaseA = stack.claim(a, "ui");
    stack.claim(b, "gameplay");
    releaseA(); // mid-stack owner leaves first
    expect(stack.top()).toBe(b);
    expect(stack.size).toBe(1);
  });

  it("release is idempotent (StrictMode-style double cleanup is safe)", () => {
    const stack = new ExclusiveClaimStack<Handler>();
    const a = h();
    const b = h();
    const releaseA = stack.claim(a, "ui");
    releaseA();
    stack.claim(b, "ui");
    releaseA(); // second call must not remove b
    expect(stack.top()).toBe(b);
    expect(stack.size).toBe(1);
  });

  it("distinguishes identical handlers by claim identity", () => {
    const stack = new ExclusiveClaimStack<Handler>();
    const same = h();
    const release1 = stack.claim(same, "ui");
    stack.claim(same, "ui");
    release1();
    expect(stack.top()).toBe(same);
    expect(stack.size).toBe(1);
  });

  it("hasGameplayClaim tracks gameplay owners anywhere in the stack", () => {
    const stack = new ExclusiveClaimStack<Handler>();
    stack.claim(h(), "ui");
    expect(stack.hasGameplayClaim()).toBe(false);
    const releasePlayer = stack.claim(h(), "gameplay");
    stack.claim(h(), "ui"); // a UI claim above the player
    expect(stack.hasGameplayClaim()).toBe(true);
    releasePlayer();
    expect(stack.hasGameplayClaim()).toBe(false);
  });
});

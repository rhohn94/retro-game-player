import { describe, expect, it } from "vitest";
import { playerShellClass, presentationOwnsController } from "./presentation";

describe("presentationOwnsController (W272 input ownership)", () => {
  it("owns the exclusive slot in foreground-class presentations", () => {
    expect(presentationOwnsController("foreground")).toBe(true);
    expect(presentationOwnsController("takeover")).toBe(true);
  });

  it("leaves the slot to the page while backgrounded (attract)", () => {
    expect(presentationOwnsController("background")).toBe(false);
  });
});

describe("playerShellClass (shared .rgp-player modifier set)", () => {
  it("is the bare shell class in the default foreground presentation", () => {
    expect(playerShellClass("foreground")).toBe("rgp-player");
  });

  it("emits the attract modifier while backgrounded", () => {
    expect(playerShellClass("background")).toBe("rgp-player rgp-player--attract");
  });

  it("emits the takeover modifier on the TV surface", () => {
    expect(playerShellClass("takeover")).toBe("rgp-player rgp-player--takeover");
  });

  it("stacks the in-page player's immersive modifier onto the presentation", () => {
    expect(playerShellClass("foreground", true)).toBe("rgp-player rgp-player--immersive");
    expect(playerShellClass("takeover", true)).toBe(
      "rgp-player rgp-player--immersive rgp-player--takeover",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  ATTRACT_GAIN,
  effectivePlayerGain,
  playerShellClass,
  presentationAllowsImmersive,
  presentationAllowsSaves,
  presentationIsSpectator,
  presentationOwnsController,
  presentationRecordsPlaySession,
} from "./presentation";

describe("presentationIsSpectator (W235 attract / W273 preview)", () => {
  it("classes background and preview as spectator surfaces", () => {
    expect(presentationIsSpectator("background")).toBe(true);
    expect(presentationIsSpectator("preview")).toBe(true);
  });

  it("classes foreground and takeover as playing surfaces", () => {
    expect(presentationIsSpectator("foreground")).toBe(false);
    expect(presentationIsSpectator("takeover")).toBe(false);
  });
});

describe("presentationOwnsController (W272 input ownership)", () => {
  it("owns the exclusive slot in foreground-class presentations", () => {
    expect(presentationOwnsController("foreground")).toBe(true);
    expect(presentationOwnsController("takeover")).toBe(true);
  });

  it("leaves the slot to the page while backgrounded (attract)", () => {
    expect(presentationOwnsController("background")).toBe(false);
  });

  it("leaves the slot to the page in the TV hover-attract preview (W273)", () => {
    expect(presentationOwnsController("preview")).toBe(false);
  });
});

describe("presentationRecordsPlaySession (W273 preview purity)", () => {
  it("records library-life sessions for every real play presentation", () => {
    expect(presentationRecordsPlaySession("foreground")).toBe(true);
    expect(presentationRecordsPlaySession("background")).toBe(true);
    expect(presentationRecordsPlaySession("takeover")).toBe(true);
  });

  it("never records a session for a preview — no play count / recency / play-time", () => {
    expect(presentationRecordsPlaySession("preview")).toBe(false);
  });
});

describe("presentationAllowsSaves (W273/W376 preview purity)", () => {
  it("allows saves for every real play presentation", () => {
    expect(presentationAllowsSaves("foreground")).toBe(true);
    expect(presentationAllowsSaves("background")).toBe(true);
    expect(presentationAllowsSaves("takeover")).toBe(true);
  });

  it("never allows saves for a preview — no SRAM / save-state writes", () => {
    expect(presentationAllowsSaves("preview")).toBe(false);
  });
});

describe("effectivePlayerGain (shared attract duck)", () => {
  it("passes the user's volume through unducked on playing surfaces", () => {
    expect(effectivePlayerGain(1, "foreground")).toBe(1);
    expect(effectivePlayerGain(0.6, "takeover")).toBe(0.6);
  });

  it("ducks to ATTRACT_GAIN × volume on spectator surfaces", () => {
    expect(effectivePlayerGain(1, "background")).toBeCloseTo(ATTRACT_GAIN);
    expect(effectivePlayerGain(1, "preview")).toBeCloseTo(ATTRACT_GAIN);
    expect(effectivePlayerGain(0.5, "preview")).toBeCloseTo(0.5 * ATTRACT_GAIN);
  });

  it("ducks a muted volume to zero regardless of presentation", () => {
    expect(effectivePlayerGain(0, "preview")).toBe(0);
  });
});

describe("presentationAllowsImmersive (W275 takeover fullscreen audit)", () => {
  it("offers the app-immersive Full screen affordance only on the desktop foreground player", () => {
    expect(presentationAllowsImmersive("foreground")).toBe(true);
  });

  it("never offers it inside the TV takeover — the window is already fullscreen and TV mode owns that state", () => {
    expect(presentationAllowsImmersive("takeover")).toBe(false);
  });

  it("never offers it on spectator surfaces (no chrome at all)", () => {
    expect(presentationAllowsImmersive("background")).toBe(false);
    expect(presentationAllowsImmersive("preview")).toBe(false);
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

  it("emits the preview modifier on the TV hover-attract surface (W273)", () => {
    expect(playerShellClass("preview")).toBe("rgp-player rgp-player--preview");
  });

  it("stacks the in-page player's immersive modifier onto the presentation", () => {
    expect(playerShellClass("foreground", true)).toBe("rgp-player rgp-player--immersive");
    expect(playerShellClass("takeover", true)).toBe(
      "rgp-player rgp-player--immersive rgp-player--takeover",
    );
  });
});

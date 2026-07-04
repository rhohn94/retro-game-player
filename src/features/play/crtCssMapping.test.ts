import { describe, expect, it } from "vitest";
import { crtConfigToCssVars } from "./crtCssMapping";
import { CRT_FILTER_OFF } from "./crtFilter";
import type { CrtFilterConfig } from "../../ipc/crt-filter";

describe("crtConfigToCssVars", () => {
  it("maps the off config to zero/neutral values", () => {
    const vars = crtConfigToCssVars(CRT_FILTER_OFF);
    expect(vars["--rgp-crt-scanline-opacity"]).toBe("0");
    expect(vars["--rgp-crt-vignette-opacity"]).toBe("0");
    expect(vars["--rgp-crt-bleed-blur"]).toBe("0px");
    expect(vars["--rgp-crt-bleed-saturate"]).toBe("100%");
    expect(vars["--rgp-crt-curvature-tilt"]).toBe("0deg");
    expect(vars["--rgp-crt-curvature-radius"]).toBe("0px");
  });

  it("maps full intensity to the documented maximum for each var", () => {
    const full: CrtFilterConfig = { scanlines: 100, curvature: 100, colorBleed: 100, vignette: 100, preset: null };
    const vars = crtConfigToCssVars(full);
    expect(vars["--rgp-crt-scanline-opacity"]).toBe("0.35");
    expect(vars["--rgp-crt-vignette-opacity"]).toBe("0.55");
    expect(vars["--rgp-crt-bleed-blur"]).toBe("1.5px");
    expect(vars["--rgp-crt-bleed-saturate"]).toBe("140%");
    expect(vars["--rgp-crt-curvature-tilt"]).toBe("4deg");
    expect(vars["--rgp-crt-curvature-radius"]).toBe("28px");
  });

  it("scales linearly at half intensity", () => {
    const half: CrtFilterConfig = { scanlines: 50, curvature: 50, colorBleed: 50, vignette: 50, preset: null };
    const vars = crtConfigToCssVars(half);
    expect(vars["--rgp-crt-scanline-opacity"]).toBe("0.175");
    expect(vars["--rgp-crt-vignette-opacity"]).toBe("0.275");
    expect(vars["--rgp-crt-bleed-blur"]).toBe("0.75px");
    expect(vars["--rgp-crt-bleed-saturate"]).toBe("120%");
    expect(vars["--rgp-crt-curvature-tilt"]).toBe("2deg");
    expect(vars["--rgp-crt-curvature-radius"]).toBe("14px");
  });

  it("each effect's CSS vars are independent of the other three intensities", () => {
    const scanlineOnly: CrtFilterConfig = { scanlines: 100, curvature: 0, colorBleed: 0, vignette: 0, preset: null };
    const vars = crtConfigToCssVars(scanlineOnly);
    expect(vars["--rgp-crt-vignette-opacity"]).toBe("0");
    expect(vars["--rgp-crt-bleed-blur"]).toBe("0px");
    expect(vars["--rgp-crt-curvature-tilt"]).toBe("0deg");
  });
});

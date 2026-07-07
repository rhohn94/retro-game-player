import { describe, expect, it } from "vitest";
import { CRT_FRAGMENT_SHADER, CRT_UNIFORM_NAMES, CRT_VERTEX_SHADER } from "./crtShader";

describe("crtShader sources", () => {
  it("declares every uniform name the renderer looks up", () => {
    for (const name of CRT_UNIFORM_NAMES) {
      expect(CRT_FRAGMENT_SHADER.includes(`uniform`) && CRT_FRAGMENT_SHADER.includes(name)).toBe(true);
    }
  });

  it("vertex shader emits a UV varying the fragment shader consumes", () => {
    expect(CRT_VERTEX_SHADER).toContain("out vec2 v_uv");
    expect(CRT_FRAGMENT_SHADER).toContain("in vec2 v_uv");
  });

  it("is GLSL ES 3.00 (WebGL2) on both stages", () => {
    expect(CRT_VERTEX_SHADER.trim().startsWith("#version 300 es")).toBe(true);
    expect(CRT_FRAGMENT_SHADER.trim().startsWith("#version 300 es")).toBe(true);
  });

  it("samples the source frame texture named u_frame", () => {
    expect(CRT_FRAGMENT_SHADER).toContain("uniform sampler2D u_frame");
    expect(CRT_FRAGMENT_SHADER).toMatch(/texture\(u_frame/);
  });

  it("every effect amount uniform is a plain float (mixed in as 0..1)", () => {
    for (const name of ["u_scanlineAmount", "u_curvatureAmount", "u_colorBleedAmount", "u_vignetteAmount"]) {
      expect(CRT_FRAGMENT_SHADER).toContain(`uniform float ${name};`);
    }
  });

  it("has no unbalanced braces (a cheap syntax sanity check)", () => {
    for (const src of [CRT_VERTEX_SHADER, CRT_FRAGMENT_SHADER]) {
      const opens = (src.match(/{/g) ?? []).length;
      const closes = (src.match(/}/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  // v0.39 W390 (crt-filter-design.md §resolution decoupling): `u_resolution`
  // is used ONLY to pace the scanline effect — that's deliberate (a real
  // CRT's scanlines track the source video signal's row count, not the
  // display's pixel density), which is why CrtWebglRenderer.draw() feeds it
  // the frame's own dimensions rather than the canvas's drawing-buffer size.
  // If a future change made curvature/color-bleed/vignette depend on
  // `u_resolution` too, they'd start tracking source resolution instead of
  // staying the resolution-independent UV math they are today — this test
  // exists so that change is a deliberate, reviewed one, not an accidental
  // side effect of some other edit.
  it("u_resolution is referenced only by the scanline effect, not by curvature/color-bleed/vignette", () => {
    const lines = CRT_FRAGMENT_SHADER.split("\n");
    const resolutionLines = lines.filter((line) => line.includes("u_resolution") && !line.includes("uniform"));
    expect(resolutionLines.length).toBeGreaterThan(0);
    for (const line of resolutionLines) {
      expect(line).toContain("row");
    }
  });
});

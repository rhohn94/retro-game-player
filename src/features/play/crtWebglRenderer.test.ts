// Unit tests for CrtWebglRenderer against a minimal hand-rolled WebGL2 stub
// (jsdom implements no WebGL at all — `canvas.getContext("webgl2")` returns
// null in every real test runner, so exercising the actual GL pipeline here
// isn't possible without a browser). The stub records calls so tests assert
// the renderer drives the API correctly (compile/link error surfacing,
// per-frame uniform values, disposal) without asserting on pixels — real
// pixel-level verification is a manual/on-device concern
// (crt-filter-design.md's acceptance criteria).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { CrtWebglRenderer, CrtWebglUnavailableError } from "./crtWebglRenderer";
import { CRT_FILTER_OFF } from "./crtFilter";
import type { CrtFilterConfig } from "../../ipc/crt-filter";

/** A fake GLenum registry so constants used as object keys/values are stable
 * across calls without depending on a real browser's numeric assignments. */
const GL_CONSTANTS = {
  VERTEX_SHADER: 1,
  FRAGMENT_SHADER: 2,
  COMPILE_STATUS: 3,
  LINK_STATUS: 4,
  TEXTURE_2D: 5,
  TEXTURE_MIN_FILTER: 6,
  TEXTURE_MAG_FILTER: 7,
  TEXTURE_WRAP_S: 8,
  TEXTURE_WRAP_T: 9,
  LINEAR: 10,
  CLAMP_TO_EDGE: 11,
  TEXTURE0: 12,
  RGBA: 13,
  UNSIGNED_BYTE: 14,
  TRIANGLES: 15,
  UNPACK_FLIP_Y_WEBGL: 16,
};

interface StubOptions {
  compileFails?: boolean;
  linkFails?: boolean;
}

/** Builds a fake WebGL2RenderingContext recording every call the renderer
 * makes, resolving getUniformLocation to a distinct sentinel per name. */
function makeGlStub(opts: StubOptions = {}) {
  const uniformValues: Record<string, unknown> = {};
  let shaderCounter = 0;

  const gl = {
    ...GL_CONSTANTS,
    createShader: vi.fn(() => ({ id: `shader-${shaderCounter++}` })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => !opts.compileFails),
    getShaderInfoLog: vi.fn(() => "stub compile error"),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ id: "program" })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => !opts.linkFails),
    getProgramInfoLog: vi.fn(() => "stub link error"),
    deleteProgram: vi.fn(),
    createVertexArray: vi.fn(() => ({ id: "vao" })),
    deleteVertexArray: vi.fn(),
    createTexture: vi.fn(() => ({ id: "texture" })),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => ({ name })),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    texImage2D: vi.fn(),
    uniform1i: vi.fn((loc: { name: string } | null, v: number) => {
      if (loc) uniformValues[loc.name] = v;
    }),
    uniform1f: vi.fn((loc: { name: string } | null, v: number) => {
      if (loc) uniformValues[loc.name] = v;
    }),
    uniform2f: vi.fn((loc: { name: string } | null, x: number, y: number) => {
      if (loc) uniformValues[loc.name] = [x, y];
    }),
    bindVertexArray: vi.fn(),
    drawArrays: vi.fn(),
    viewport: vi.fn(),
  };

  return { gl, uniformValues };
}

function stubCanvas(gl: unknown): HTMLCanvasElement {
  return {
    getContext: vi.fn(() => gl),
  } as unknown as HTMLCanvasElement;
}

describe("CrtWebglRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws CrtWebglUnavailableError when the canvas yields no WebGL2 context", () => {
    const canvas = stubCanvas(null);
    expect(() => new CrtWebglRenderer(canvas)).toThrow(CrtWebglUnavailableError);
  });

  it("throws a descriptive error when shader compilation fails", () => {
    const { gl } = makeGlStub({ compileFails: true });
    const canvas = stubCanvas(gl);
    expect(() => new CrtWebglRenderer(canvas)).toThrow(/compile failed/);
  });

  it("throws a descriptive error when program linking fails", () => {
    const { gl } = makeGlStub({ linkFails: true });
    const canvas = stubCanvas(gl);
    expect(() => new CrtWebglRenderer(canvas)).toThrow(/link failed/);
  });

  it("constructs cleanly against a healthy stub context", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    expect(() => new CrtWebglRenderer(canvas)).not.toThrow();
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("flips the frame vertically at texture upload (W301 regression: native cores deliver top-down rows, WebGL expects bottom-up)", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    new CrtWebglRenderer(canvas);

    // Must be set (true) before any texImage2D upload so every uploaded
    // frame is flipped to compensate for the row-major top-down source
    // buffer (src-tauri/src/play/native/frame.rs) vs. WebGL's bottom-left
    // texture origin. Without this, row 0 of the source (the top of the
    // real frame) lands at the bottom of the rendered image.
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, true);
    const pixelStoreiOrder = gl.pixelStorei.mock.invocationCallOrder[0];
    const texImage2DCalls = gl.texImage2D.mock.invocationCallOrder;
    if (texImage2DCalls.length > 0) {
      expect(pixelStoreiOrder).toBeLessThan(texImage2DCalls[0]);
    }
  });

  it("draw() renders a distinct-first-row test pattern right-side-up: the flip flag is active for every upload so the source's top row is not sent to the GL bottom-left origin unflipped", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    // 2x2 RGBA test pattern with a distinct first row (red) vs. last row
    // (blue) — row-major top-down, matching frame.rs's real buffer layout.
    const width = 2;
    const height = 2;
    const bytes = new Uint8ClampedArray(4 * width * height);
    // Row 0 (top of source): red.
    bytes.set([255, 0, 0, 255], 0);
    bytes.set([255, 0, 0, 255], 4);
    // Row 1 (bottom of source): blue.
    bytes.set([0, 0, 255, 255], 8);
    bytes.set([0, 0, 255, 255], 12);

    renderer.draw(bytes, width, height, CRT_FILTER_OFF);

    // The renderer must have the flip enabled at upload time so the GL
    // texture's row 0 (bottom-left origin) receives the source's last row,
    // and the source's first (top) row ends up sampled at v_uv.y == 1 —
    // i.e. rendered at the top of the screen, right-side-up.
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, true);
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
  });

  it("draw() uploads the frame texture and sets every effect uniform from the config", () => {
    const { gl, uniformValues } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    const config: CrtFilterConfig = { scanlines: 50, curvature: 25, colorBleed: 10, vignette: 100, preset: null };
    const bytes = new Uint8ClampedArray(4 * 2 * 2);
    renderer.draw(bytes, 2, 2, config);

    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      2,
      2,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    expect(uniformValues.u_scanlineAmount).toBeCloseTo(0.5);
    expect(uniformValues.u_curvatureAmount).toBeCloseTo(0.25);
    expect(uniformValues.u_colorBleedAmount).toBeCloseTo(0.1);
    expect(uniformValues.u_vignetteAmount).toBeCloseTo(1);
    expect(uniformValues.u_resolution).toEqual([2, 2]);
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
  });

  it("draw() with the off preset sets every amount uniform to zero", () => {
    const { gl, uniformValues } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);
    renderer.draw(new Uint8ClampedArray(4), 1, 1, CRT_FILTER_OFF);
    expect(uniformValues.u_scanlineAmount).toBe(0);
    expect(uniformValues.u_curvatureAmount).toBe(0);
    expect(uniformValues.u_colorBleedAmount).toBe(0);
    expect(uniformValues.u_vignetteAmount).toBe(0);
  });

  it("dispose() frees the texture, VAO, and program exactly once", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);
    renderer.dispose();
    renderer.dispose(); // idempotent — must not double-free
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it("draw() is a no-op after dispose()", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);
    renderer.dispose();
    vi.clearAllMocks();
    renderer.draw(new Uint8ClampedArray(4), 1, 1, CRT_FILTER_OFF);
    expect(gl.texImage2D).not.toHaveBeenCalled();
    expect(gl.drawArrays).not.toHaveBeenCalled();
  });
});

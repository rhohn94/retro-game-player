// Unit tests for CrtWebglRenderer against a minimal hand-rolled WebGL2 stub
// (jsdom implements no WebGL at all — `canvas.getContext("webgl2")` returns
// null in every real test runner, so exercising the actual GL pipeline here
// isn't possible without a browser). The stub records calls so tests assert
// the renderer drives the API correctly (compile/link error surfacing,
// per-frame uniform values, disposal) without asserting on pixels — real
// pixel-level verification is a manual/on-device concern
// (crt-filter-design.md's acceptance criteria).
//
// The `UNPACK_FLIP_Y_WEBGL` regression tests below are the one exception:
// the stub's `pixelStorei`/`texImage2D` actually model that pixel-store
// parameter's well-defined row-reversal semantics (WebGL2 spec, Pixel
// Storage Parameters) so the tests can assert on the resulting row order
// itself, not just that a call occurred.
//
// v0.38 W381: the stub's `texImage2D`/`texSubImage2D` also model real
// allocate-vs-update semantics (a tracked "allocated size" per texture) so
// the "allocate once, texSubImage2D thereafter" tests below can catch a
// regression back to re-`texImage2D`-ing every frame — a vacuous mock that
// only records "some call happened" wouldn't catch that (W301 lesson). The
// timer-query tests use a second stub extension object modeling
// `EXT_disjoint_timer_query_webgl2`'s query lifecycle (create/begin/end/poll)
// closely enough to prove the renderer only reads a resolved, non-disjoint
// result.

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
  QUERY_RESULT_AVAILABLE: 17,
  QUERY_RESULT: 18,
};

/** Fake `EXT_disjoint_timer_query_webgl2` constants, distinct from
 * `GL_CONSTANTS` (a real browser assigns these on the extension object, not
 * the base context). */
const TIMER_EXT_CONSTANTS = {
  TIME_ELAPSED_EXT: 100,
  GPU_DISJOINT_EXT: 101,
};

interface StubOptions {
  compileFails?: boolean;
  linkFails?: boolean;
  /** When true, `getExtension("EXT_disjoint_timer_query_webgl2")` returns the
   * fake extension object below; when false (default) it returns `null`,
   * modeling a browser/driver that doesn't support timer queries. */
  timerQuerySupported?: boolean;
  /** v0.39 W390: the stub's `drawingBufferWidth`/`drawingBufferHeight` — a
   * real WebGL2 context derives these from the canvas's own backing-store
   * size, independently of whatever dimensions a given `draw()` call's frame
   * texture uses. Defaults to a size distinct from every test's frame
   * dimensions so a regression back to viewport-tracks-frame-size would be
   * caught even by tests that don't pass this explicitly. */
  drawingBufferWidth?: number;
  drawingBufferHeight?: number;
}

/** Reverses the row order of an RGBA8888 buffer — the well-defined transform
 * `UNPACK_FLIP_Y_WEBGL=true` applies at pixel unpack time per the WebGL2
 * spec (Pixel Storage Parameters): row `y` of the source becomes row
 * `height-1-y` of the unpacked result. Used by the stub below to actually
 * model flip semantics instead of merely recording that a flag was set. */
function flipRows(bytes: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const rowBytes = width * 4;
  const flipped = new Uint8ClampedArray(bytes.length);
  for (let y = 0; y < height; y++) {
    const srcStart = y * rowBytes;
    const destStart = (height - 1 - y) * rowBytes;
    flipped.set(bytes.subarray(srcStart, srcStart + rowBytes), destStart);
  }
  return flipped;
}

/** Builds a fake WebGL2RenderingContext recording every call the renderer
 * makes, resolving getUniformLocation to a distinct sentinel per name.
 *
 * `pixelStorei`/`texImage2D` model real `UNPACK_FLIP_Y_WEBGL` semantics (not
 * just call recording): `unpackFlipY` defaults to `false` per the WebGL2
 * spec, `pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, v)` updates it, and `texImage2D`
 * applies `flipRows` to the incoming pixel buffer whenever the flag is active
 * at upload time — mirroring what a real driver does to the source bytes
 * before they land in the texture. The (possibly flipped) result is stored on
 * `gl._lastUploadedPixels` so tests can assert on actual row order rather
 * than just on the raw (pre-transform) call arguments. */
function makeGlStub(opts: StubOptions = {}) {
  const uniformValues: Record<string, unknown> = {};
  let shaderCounter = 0;
  const flipState = { unpackFlipY: false };
  // v0.38 W381: tracks the texture's currently-allocated dimensions the way
  // a real driver would — `texImage2D` (re-)allocates storage at whatever
  // size it's called with; `texSubImage2D` only ever writes into storage
  // that must already exist at that size (a real driver raises INVALID_
  // OPERATION on a size mismatch — the stub instead throws, since these
  // tests never intend to exercise that error path).
  const allocatedSize: { width: number | null; height: number | null } = { width: null, height: null };
  let texImage2DCallCount = 0;
  let texSubImage2DCallCount = 0;
  let queryCounter = 0;
  let queryResultNs = 1_500_000; // 1.5ms, an arbitrary but realistic default
  let gpuDisjoint = false;

  const gl = {
    ...GL_CONSTANTS,
    // v0.39 W390: a real WebGL2RenderingContext exposes these as plain data
    // properties (not methods) reflecting the bound canvas's own backing-
    // store size — deliberately defaulted to a value distinct from every
    // test's frame dimensions (800×600 vs. tests' 1×1/2×2/4×3 frames) so
    // `draw()` reading this instead of the frame width/height is actually
    // exercised, not accidentally coincidental.
    drawingBufferWidth: opts.drawingBufferWidth ?? 800,
    drawingBufferHeight: opts.drawingBufferHeight ?? 600,
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
    pixelStorei: vi.fn((pname: number, value: boolean) => {
      if (pname === GL_CONSTANTS.UNPACK_FLIP_Y_WEBGL) flipState.unpackFlipY = value;
    }),
    getUniformLocation: vi.fn((_program: unknown, name: string) => ({ name })),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    texImage2D: vi.fn(
      (
        _target: number,
        _level: number,
        _internalFormat: number,
        width: number,
        height: number,
        _border: number,
        _format: number,
        _type: number,
        pixels?: Uint8ClampedArray,
      ) => {
        texImage2DCallCount++;
        allocatedSize.width = width;
        allocatedSize.height = height;
        if (pixels) {
          gl._lastUploadedPixels = flipState.unpackFlipY ? flipRows(pixels, width, height) : pixels.slice();
        }
      },
    ),
    texSubImage2D: vi.fn(
      (
        _target: number,
        _level: number,
        xoffset: number,
        yoffset: number,
        width: number,
        height: number,
        _format: number,
        _type: number,
        pixels: Uint8ClampedArray,
      ) => {
        texSubImage2DCallCount++;
        // Real drivers require the sub-region to fit inside already-allocated
        // storage — surface a stub error rather than silently "succeeding" if
        // the renderer ever calls this before an allocating texImage2D (the
        // regression this whole stub upgrade exists to catch).
        if (allocatedSize.width === null || allocatedSize.height === null) {
          throw new Error("texSubImage2D called before any texImage2D allocated storage");
        }
        if (xoffset !== 0 || yoffset !== 0 || width !== allocatedSize.width || height !== allocatedSize.height) {
          throw new Error("texSubImage2D region does not match the stub's allocated size");
        }
        gl._lastUploadedPixels = flipState.unpackFlipY ? flipRows(pixels, width, height) : pixels.slice();
      },
    ),
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
    getExtension: vi.fn((name: string) => {
      if (name === "EXT_disjoint_timer_query_webgl2" && opts.timerQuerySupported) {
        return TIMER_EXT_CONSTANTS;
      }
      return null;
    }),
    createQuery: vi.fn(() => ({ id: `query-${queryCounter++}` })),
    deleteQuery: vi.fn(),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    getQueryParameter: vi.fn((_query: unknown, pname: number) => {
      if (pname === GL_CONSTANTS.QUERY_RESULT_AVAILABLE) return true;
      if (pname === GL_CONSTANTS.QUERY_RESULT) return queryResultNs;
      return null;
    }),
    getParameter: vi.fn((pname: number) => {
      if (pname === TIMER_EXT_CONSTANTS.GPU_DISJOINT_EXT) return gpuDisjoint;
      return null;
    }),
    /** Set by the `texImage2D`/`texSubImage2D` stubs above to the (possibly
     * flipped) buffer that "reached the GPU" — the actual post-transform row
     * order, for tests to inspect directly instead of just checking a call
     * happened. */
    _lastUploadedPixels: undefined as Uint8ClampedArray | undefined,
    /** Test-only accessors into the stub's tracked allocation/query state. */
    _texImage2DCallCount: () => texImage2DCallCount,
    _texSubImage2DCallCount: () => texSubImage2DCallCount,
    _setQueryResultNs: (ns: number) => {
      queryResultNs = ns;
    },
    _setGpuDisjoint: (disjoint: boolean) => {
      gpuDisjoint = disjoint;
    },
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

  it("draw() actually reverses source row order at upload time, so a top-red/bottom-blue source lands GPU-side as top-blue/bottom-red (i.e. right-side-up once WebGL's bottom-left texture origin is accounted for)", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    // 2x2 RGBA test pattern with a distinct first row (red) vs. last row
    // (blue) — row-major top-down, matching frame.rs's real buffer layout.
    const width = 2;
    const height = 2;
    const bytes = new Uint8ClampedArray(4 * width * height);
    const RED = [255, 0, 0, 255];
    const BLUE = [0, 0, 255, 255];
    // Row 0 (top of source): red.
    bytes.set(RED, 0);
    bytes.set(RED, 4);
    // Row 1 (bottom of source): blue.
    bytes.set(BLUE, 8);
    bytes.set(BLUE, 12);

    renderer.draw(bytes, width, height, CRT_FILTER_OFF);

    // The flip must be enabled at upload time...
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, true);
    // ...and texImage2D is still invoked with the renderer's own unmodified
    // source buffer (the renderer itself never reorders bytes — it delegates
    // that to the GL unpack step via the pixelStorei flag).
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

    // The load-bearing assertion: inspect what the stub's simulated "GPU
    // unpack" step actually produced. UNPACK_FLIP_Y_WEBGL=true reverses row
    // order at unpack time, so the source's row 0 (red, top) must now sit at
    // the LAST row slot, and the source's row 1 (blue, bottom) at the FIRST
    // row slot. Combined with WebGL's bottom-left texture origin (texture
    // row 0 == bottom of screen), this is exactly what makes the red row
    // render at the top of the screen and the blue row at the bottom —
    // right-side-up. If the fix were reverted (flip flag false or omitted),
    // `_lastUploadedPixels` would equal the unflipped source, and this
    // assertion would fail.
    const uploaded = gl._lastUploadedPixels;
    expect(uploaded).toBeDefined();
    expect(Array.from(uploaded!.subarray(0, 4))).toEqual(BLUE);
    expect(Array.from(uploaded!.subarray(4, 8))).toEqual(BLUE);
    expect(Array.from(uploaded!.subarray(8, 12))).toEqual(RED);
    expect(Array.from(uploaded!.subarray(12, 16))).toEqual(RED);
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

  it("draw() sizes the viewport from the canvas's drawing-buffer size, not the frame's dimensions (v0.39 W390: resolution decoupling)", () => {
    const { gl } = makeGlStub({ drawingBufferWidth: 1920, drawingBufferHeight: 1080 });
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    // A tiny NES-scale frame (256x240) uploaded while the canvas's actual
    // drawing buffer is a full 1920x1080 display — the viewport must follow
    // the display size, not the frame size, so the shader's curvature/
    // color-bleed/vignette math (already resolution-independent UV math in
    // crtShader.ts) actually runs at full display fidelity.
    renderer.draw(new Uint8ClampedArray(4 * 256 * 240), 256, 240, CRT_FILTER_OFF);
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1920, 1080);
  });

  it("draw()'s u_resolution uniform still reflects the frame's own dimensions, not the drawing-buffer size (v0.39 W390: scanline pitch must keep tracking the source signal's row count, not the display's pixel density)", () => {
    const { gl, uniformValues } = makeGlStub({ drawingBufferWidth: 1920, drawingBufferHeight: 1080 });
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    renderer.draw(new Uint8ClampedArray(4 * 256 * 240), 256, 240, CRT_FILTER_OFF);
    // If this regressed to reflect the drawing-buffer size instead, a 240-row
    // NES frame's scanlines would be paced by however many rows the display
    // has — a fidelity REGRESSION for that effect, not a gain (unlike
    // curvature/color-bleed/vignette, which need no uniform change at all).
    expect(uniformValues.u_resolution).toEqual([256, 240]);
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

  it("allocates the texture with texImage2D on the first draw, then uses texSubImage2D for subsequent same-size draws (v0.38 W381: avoids re-allocating GPU storage every frame)", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    const bytes1 = new Uint8ClampedArray(4 * 2 * 2).fill(1);
    renderer.draw(bytes1, 2, 2, CRT_FILTER_OFF);
    expect(gl._texImage2DCallCount()).toBe(1);
    expect(gl._texSubImage2DCallCount()).toBe(0);

    const bytes2 = new Uint8ClampedArray(4 * 2 * 2).fill(2);
    renderer.draw(bytes2, 2, 2, CRT_FILTER_OFF);
    // Same dimensions as before — must reuse the allocated storage via
    // texSubImage2D, NOT call texImage2D again. If this regressed back to
    // re-texImage2D-ing every frame, this assertion would fail.
    expect(gl._texImage2DCallCount()).toBe(1);
    expect(gl._texSubImage2DCallCount()).toBe(1);
    expect(Array.from(gl._lastUploadedPixels!.subarray(0, 4))).toEqual([2, 2, 2, 2]);

    const bytes3 = new Uint8ClampedArray(4 * 2 * 2).fill(3);
    renderer.draw(bytes3, 2, 2, CRT_FILTER_OFF);
    expect(gl._texImage2DCallCount()).toBe(1);
    expect(gl._texSubImage2DCallCount()).toBe(2);
  });

  it("reallocates via texImage2D when the frame dimensions change (resize)", () => {
    const { gl } = makeGlStub();
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    renderer.draw(new Uint8ClampedArray(4 * 2 * 2), 2, 2, CRT_FILTER_OFF);
    expect(gl._texImage2DCallCount()).toBe(1);

    // A genuine geometry change (e.g. core renegotiation) — must reallocate,
    // not attempt a texSubImage2D into storage sized for the old dimensions.
    renderer.draw(new Uint8ClampedArray(4 * 4 * 3), 4, 3, CRT_FILTER_OFF);
    expect(gl._texImage2DCallCount()).toBe(2);
    expect(gl._texSubImage2DCallCount()).toBe(0);

    // Back to the new size again — now reuses via texSubImage2D.
    renderer.draw(new Uint8ClampedArray(4 * 4 * 3), 4, 3, CRT_FILTER_OFF);
    expect(gl._texImage2DCallCount()).toBe(2);
    expect(gl._texSubImage2DCallCount()).toBe(1);
  });

  it("lastDrawCostMs stays null and no query is created when EXT_disjoint_timer_query_webgl2 is unsupported", () => {
    const { gl } = makeGlStub({ timerQuerySupported: false });
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    renderer.draw(new Uint8ClampedArray(4), 1, 1, CRT_FILTER_OFF);
    expect(gl.createQuery).not.toHaveBeenCalled();
    expect(gl.beginQuery).not.toHaveBeenCalled();
    expect(gl.endQuery).not.toHaveBeenCalled();
    expect(renderer.lastDrawCostMs).toBeNull();
  });

  it("lastDrawCostMs surfaces a resolved, non-disjoint timer-query result in milliseconds when the extension is supported", () => {
    const { gl } = makeGlStub({ timerQuerySupported: true });
    gl._setQueryResultNs(2_500_000); // 2.5ms
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    renderer.draw(new Uint8ClampedArray(4), 1, 1, CRT_FILTER_OFF);
    expect(gl.createQuery).toHaveBeenCalledTimes(1);
    expect(gl.beginQuery).toHaveBeenCalledWith(TIMER_EXT_CONSTANTS.TIME_ELAPSED_EXT, expect.anything());
    expect(gl.endQuery).toHaveBeenCalledWith(TIMER_EXT_CONSTANTS.TIME_ELAPSED_EXT);
    expect(renderer.lastDrawCostMs).toBeCloseTo(2.5);
  });

  it("discards a disjoint timer-query result instead of surfacing it as lastDrawCostMs", () => {
    const { gl } = makeGlStub({ timerQuerySupported: true });
    gl._setQueryResultNs(9_000_000);
    gl._setGpuDisjoint(true);
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    renderer.draw(new Uint8ClampedArray(4), 1, 1, CRT_FILTER_OFF);
    // A disjoint result must never be published — the driver flagged this
    // measurement window as unreliable (e.g. a GPU reset occurred).
    expect(renderer.lastDrawCostMs).toBeNull();
  });

  it("skips starting a new timer query while a previous one hasn't resolved yet, so queries never stack up", () => {
    const { gl } = makeGlStub({ timerQuerySupported: true });
    // Make the query never report as available, simulating a query still
    // in flight from the previous draw.
    // `false` (never available) isn't in the stub's declared return-type
    // union (`number | true | null`, mirroring what a real WebGL2 query
    // parameter getter returns), so it's cast at the boundary here rather
    // than widening the shared stub's signature for every other test.
    gl.getQueryParameter.mockImplementation(((_query: unknown, pname: number) => {
      if (pname === gl.QUERY_RESULT_AVAILABLE) return false;
      return null;
    }) as typeof gl.getQueryParameter);
    const canvas = stubCanvas(gl);
    const renderer = new CrtWebglRenderer(canvas);

    renderer.draw(new Uint8ClampedArray(4), 1, 1, CRT_FILTER_OFF);
    expect(gl.createQuery).toHaveBeenCalledTimes(1);

    renderer.draw(new Uint8ClampedArray(4), 1, 1, CRT_FILTER_OFF);
    // The first query is still pending (never resolves in this test), so a
    // second query must not be created on top of it.
    expect(gl.createQuery).toHaveBeenCalledTimes(1);
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

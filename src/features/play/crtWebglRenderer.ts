// CrtWebglRenderer — owns the native path's WebGL2 presentation pipeline
// (v0.29 W280, crt-filter-design.md). Replaces NativePlayer.tsx's old
// Canvas2D `putImageData` paint step: each polled RGBA frame is uploaded as a
// texture and drawn through crtShader.ts's combined scanline/curvature/
// color-bleed/vignette fragment shader, parameterized by a `CrtFilterConfig`
// applied every draw. One instance per mounted <canvas>; `dispose()` frees
// every GL resource on unmount (no leaked textures/programs across
// navigations, matching the app's existing teardown discipline elsewhere in
// this file's siblings).
//
// Deliberately framework-free (no React) so it's usable from a plain ref
// callback and unit-testable against a minimal WebGL2 stub without mounting
// a component.
//
// v0.38 W381 (performance-tooling-design.md §Frame-path measurements,
// crt-filter-design.md §measurement): two perf changes over the original
// W280 pipeline. (1) The texture is allocated once (`texImage2D` with a null
// pixel source) and re-used across draws via `texSubImage2D` as long as the
// frame's dimensions don't change, only reallocating (a fresh `texImage2D`)
// on a genuine geometry change — avoids re-specifying the texture's storage
// on every single frame. (2) When the browser exposes
// `EXT_disjoint_timer_query_webgl2`, each draw is bracketed by a timer query
// and the previous query's result (once available, polled non-blockingly) is
// surfaced via `lastDrawCostMs` — real GPU draw-cost numbers replacing W280's
// analytical shader-cost budget (closes issue #35). Completely inert (no
// queries created, `lastDrawCostMs` stays `null`) when the extension isn't
// available.
//
// v0.39 W390 (crt-filter-design.md §resolution decoupling): `draw()`'s
// viewport now tracks the canvas's own drawing-buffer size instead of the
// uploaded frame's dimensions — the caller (NativePlayer.tsx) sizes the
// canvas's backing store to the host display's actual resolution, decoupled
// from the game's native frame resolution, so the shader runs at full
// display fidelity while the frame texture stays at the game's own
// resolution. See the `draw()` method comment for what does and doesn't
// change as a result.

import { CRT_FRAGMENT_SHADER, CRT_UNIFORM_NAMES, CRT_VERTEX_SHADER, type CrtUniformName } from "./crtShader";
import { toUnit } from "./crtFilter";
import type { CrtFilterConfig } from "../../ipc/crt-filter";

/** Thrown when the canvas can't produce a WebGL2 context (e.g. software
 * fallback disabled, exhausted context budget) — the caller decides whether
 * to fall back to a plain 2D paint. */
export class CrtWebglUnavailableError extends Error {
  constructor() {
    super("WebGL2 is not available on this canvas");
    this.name = "CrtWebglUnavailableError";
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("gl.createShader returned null");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no info log)";
    gl.deleteShader(shader);
    throw new Error(`CRT shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("gl.createProgram returned null");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no info log)";
    gl.deleteProgram(program);
    throw new Error(`CRT shader link failed: ${log}`);
  }
  return program;
}

/** A `EXT_disjoint_timer_query_webgl2` extension instance, typed loosely
 * since it isn't part of TypeScript's built-in WebGL2 lib types. Only the
 * handful of members this renderer actually uses are declared. */
interface DisjointTimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** Renders polled native-play RGBA frames through the CRT fragment shader
 * onto a WebGL2 canvas. See file header for lifecycle/ownership. */
export class CrtWebglRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms: Record<CrtUniformName, WebGLUniformLocation | null>;
  private disposed = false;

  // v0.38 W381: allocate-once texture storage. `null` until the first draw
  // allocates it; a later draw whose dimensions differ reallocates (a fresh
  // `texImage2D`) instead of trying to grow the existing storage in place.
  private textureWidth: number | null = null;
  private textureHeight: number | null = null;

  // v0.38 W381: GPU timer query state. `timerExt` stays `null` (every method
  // below becomes a no-op) when the browser doesn't expose
  // `EXT_disjoint_timer_query_webgl2` — feature-detected once at construction,
  // never retried per draw.
  private readonly timerExt: DisjointTimerQueryExt | null;
  private pendingQuery: WebGLQuery | null = null;
  private lastDrawCostMsValue: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) throw new CrtWebglUnavailableError();
    this.gl = gl;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, CRT_VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, CRT_FRAGMENT_SHADER);
    this.program = linkProgram(gl, vertex, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    // No vertex buffer needed (the vertex shader derives positions from
    // gl_VertexID), but WebGL2 core profile requires a bound VAO to draw.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("gl.createVertexArray returned null");
    this.vao = vao;

    const texture = gl.createTexture();
    if (!texture) throw new Error("gl.createTexture returned null");
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // libretro/fceumm (and native cores generally) deliver RGBA8888 frames
    // row-major top-down (row 0 = top; src-tauri/src/play/native/frame.rs),
    // but WebGL's texture coordinate origin is bottom-left. Flipping at the
    // texture-upload boundary compensates for that without touching any
    // downstream UV math (barrel warp / scanlines / vignette in crtShader.ts
    // all keep operating on a "right-side-up" v_uv space). Regression: W301
    // (issue #37) — native NES gameplay rendered upside down without this.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.uniforms = Object.fromEntries(
      CRT_UNIFORM_NAMES.map((name) => [name, gl.getUniformLocation(this.program, name)]),
    ) as Record<CrtUniformName, WebGLUniformLocation | null>;

    // Feature-detect the timer-query extension once. `getExtension` returns
    // `null` on any browser/driver that doesn't support it — that's a normal,
    // expected outcome (not every GPU/driver combination exposes disjoint
    // timer queries), not a construction failure.
    this.timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2") as DisjointTimerQueryExt | null;
  }

  /** Uploads one RGBA8888 frame and draws it through the shader with the
   * given config. `width`/`height` must match `bytes.length / 4` — this is
   * the frame's own (game-native) resolution, used only to size the texture
   * upload; see the inline comment below (v0.39 W390) for why the draw
   * viewport is intentionally a different value. */
  draw(bytes: Uint8ClampedArray, width: number, height: number, config: CrtFilterConfig): void {
    if (this.disposed) return;
    const gl = this.gl;

    // v0.39 W390 (crt-filter-design.md §resolution decoupling): the viewport
    // — and therefore how many fragment-shader invocations actually run —
    // tracks the canvas's own drawing-buffer size (the host display's
    // rendered resolution, set by the caller independently of the frame's
    // dimensions), NOT the frame's native resolution. `u_resolution` below is
    // deliberately left driven by the frame's `width`/`height`: it only feeds
    // the scanline pitch, which must keep tracking the source signal's row
    // count (a real CRT's scanlines are locked to the video signal, not the
    // display's pixel density) — decoupling that one too would turn a
    // 240-row NES frame's scanlines into however-many-rows-the-display-has,
    // a regression, not a fidelity gain. Curvature/color-bleed/vignette need
    // no uniform change at all: they're already pure UV-space math
    // (crtShader.ts), so they gain real fidelity from the larger viewport
    // for free — more fragment invocations sampling the same continuous
    // function and the same `LINEAR`-filtered source texture.
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // v0.38 W381: allocate the texture's storage once and re-upload pixels
    // via texSubImage2D thereafter — texImage2D re-specifies (and typically
    // reallocates) GPU storage every call, which is wasted work once the
    // frame's dimensions have settled (the overwhelming common case: a
    // session's geometry only changes on a genuine core renegotiation).
    if (this.textureWidth === width && this.textureHeight === height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      this.textureWidth = width;
      this.textureHeight = height;
    }

    gl.uniform1i(this.uniforms.u_frame, 0);
    gl.uniform1f(this.uniforms.u_scanlineAmount, toUnit(config.scanlines));
    gl.uniform1f(this.uniforms.u_curvatureAmount, toUnit(config.curvature));
    gl.uniform1f(this.uniforms.u_colorBleedAmount, toUnit(config.colorBleed));
    gl.uniform1f(this.uniforms.u_vignetteAmount, toUnit(config.vignette));
    gl.uniform2f(this.uniforms.u_resolution, width, height);

    gl.bindVertexArray(this.vao);

    const query = this.beginTimerQuery();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (query) this.endTimerQuery(query);
  }

  /** Starts a new GPU timer query bracketing the upcoming `drawArrays` call,
   * first polling (non-blockingly) any still-pending query from a previous
   * draw so `lastDrawCostMs` stays reasonably fresh. Returns `null` (and
   * does nothing else) when the extension isn't available — callers must
   * skip `endTimerQuery` in that case. */
  private beginTimerQuery(): WebGLQuery | null {
    if (!this.timerExt) return null;
    const gl = this.gl;
    this.pollPendingQuery();
    if (this.pendingQuery) return null; // previous query hasn't resolved yet — skip this frame rather than stack queries
    const query = gl.createQuery();
    if (!query) return null;
    gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, query);
    return query;
  }

  /** Ends the timer query started by `beginTimerQuery` and records it as
   * pending for a later poll (GPU timer queries are never available
   * synchronously — they must be checked on a subsequent frame). */
  private endTimerQuery(query: WebGLQuery): void {
    if (!this.timerExt) return;
    this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this.pendingQuery = query;
  }

  /** Non-blockingly checks whether the pending query (if any) has resolved;
   * if so, records its result (nanoseconds -> ms) as `lastDrawCostMs` unless
   * the result is disjoint (driver-reported as unreliable, e.g. a GPU reset
   * occurred mid-measurement), in which case the stale sample is discarded
   * rather than published. Frees the query object either way once resolved. */
  private pollPendingQuery(): void {
    if (!this.timerExt || !this.pendingQuery) return;
    const gl = this.gl;
    const query = this.pendingQuery;
    const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean;
    if (!available) return;
    const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) {
      const elapsedNs = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      this.lastDrawCostMsValue = elapsedNs / 1_000_000;
    }
    gl.deleteQuery(query);
    this.pendingQuery = null;
  }

  /** The most recently resolved GPU draw cost, in milliseconds — `null` when
   * the timer-query extension is unavailable, or no query has resolved yet
   * this session. Real measured cost (v0.38 W381), replacing the v0.29 W280
   * analytical shader-cost budget (crt-filter-design.md §measurement). */
  get lastDrawCostMs(): number | null {
    this.pollPendingQuery();
    return this.lastDrawCostMsValue;
  }

  /** Frees every GL resource this instance owns. Safe to call multiple
   * times; subsequent `draw()` calls become no-ops. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (this.pendingQuery) {
      gl.deleteQuery(this.pendingQuery);
      this.pendingQuery = null;
    }
    gl.deleteTexture(this.texture);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

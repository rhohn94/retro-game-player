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

/** Renders polled native-play RGBA frames through the CRT fragment shader
 * onto a WebGL2 canvas. See file header for lifecycle/ownership. */
export class CrtWebglRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms: Record<CrtUniformName, WebGLUniformLocation | null>;
  private disposed = false;

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
  }

  /** Uploads one RGBA8888 frame and draws it through the shader with the
   * given config. `width`/`height` must match `bytes.length / 4`. */
  draw(bytes: Uint8ClampedArray, width: number, height: number, config: CrtFilterConfig): void {
    if (this.disposed) return;
    const gl = this.gl;

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

    gl.uniform1i(this.uniforms.u_frame, 0);
    gl.uniform1f(this.uniforms.u_scanlineAmount, toUnit(config.scanlines));
    gl.uniform1f(this.uniforms.u_curvatureAmount, toUnit(config.curvature));
    gl.uniform1f(this.uniforms.u_colorBleedAmount, toUnit(config.colorBleed));
    gl.uniform1f(this.uniforms.u_vignetteAmount, toUnit(config.vignette));
    gl.uniform2f(this.uniforms.u_resolution, width, height);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Frees every GL resource this instance owns. Safe to call multiple
   * times; subsequent `draw()` calls become no-ops. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

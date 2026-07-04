// crtShader — the GLSL sources for the native-path CRT filter (v0.29 W280,
// crt-filter-design.md). Pure string constants + small pure helpers so the
// shader text itself is unit-testable (uniform names present, no stray
// syntax) without spinning up a real WebGL2 context. Consumed exclusively by
// CrtWebglRenderer (crtWebglRenderer.ts).

/** Vertex shader: a single full-viewport triangle (no vertex buffer needed —
 * positions are derived from `gl_VertexID`), UV handed to the fragment stage. */
export const CRT_VERTEX_SHADER = `#version 300 es
out vec2 v_uv;
void main() {
  // Fullscreen triangle trick: 3 vertices covering the whole clip-space quad
  // with no VBO — (0,0),(2,0),(0,2) in UV space, clipped to the viewport.
  vec2 uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Fragment shader: samples the uploaded frame texture through a single
 * combined pass — barrel curvature (UV warp) -> RGB channel-offset color
 * bleed -> scanline attenuation -> vignette darkening. Every effect is
 * parameterized by a `u_*Amount` uniform in [0, 1] (mapped from the 0-100
 * config intensity by the renderer); `0.0` for every uniform must reduce to
 * an unmodified passthrough of the source pixel (verified by
 * crtShader.test.ts's "off-preset is a passthrough" reasoning check and by
 * NativePlayer's shader-cost budget measurement in crt-filter-design.md).
 */
export const CRT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_frame;
uniform float u_scanlineAmount;   // 0..1
uniform float u_curvatureAmount;  // 0..1
uniform float u_colorBleedAmount; // 0..1
uniform float u_vignetteAmount;   // 0..1
uniform vec2 u_resolution;        // frame size in pixels, for scanline pitch

// Barrel-warps uv around the center; amount 0 = no warp.
vec2 barrelWarp(vec2 uv, float amount) {
  vec2 centered = uv * 2.0 - 1.0;          // [-1, 1]
  float r2 = dot(centered, centered);
  vec2 warped = centered * (1.0 + amount * 0.35 * r2);
  return warped * 0.5 + 0.5;
}

void main() {
  vec2 uv = barrelWarp(v_uv, u_curvatureAmount);

  // Outside the warped unit square: paint black rather than sampling
  // out-of-bounds (the curvature "shrinks" the visible image into a dark
  // frame, which reads as a CRT bezel rather than a stretched artifact).
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // RGB channel-offset color bleed: each channel samples a slightly
  // different UV along x, the classic analog-video fringing look.
  float bleed = u_colorBleedAmount * 0.006;
  float r = texture(u_frame, uv + vec2(bleed, 0.0)).r;
  float g = texture(u_frame, uv).g;
  float b = texture(u_frame, uv - vec2(bleed, 0.0)).b;
  vec3 color = vec3(r, g, b);

  // Scanlines: attenuate alternating rows by a cosine wave over the
  // destination pixel row so the pitch always matches the source frame's
  // resolution regardless of how the canvas is scaled on screen.
  float row = uv.y * u_resolution.y;
  float scanline = mix(1.0, 0.5 + 0.5 * cos(row * 3.14159265), u_scanlineAmount);
  color *= scanline;

  // Vignette: darken toward the corners.
  vec2 centered = uv * 2.0 - 1.0;
  float vignette = 1.0 - u_vignetteAmount * 0.6 * dot(centered, centered);
  color *= clamp(vignette, 0.0, 1.0);

  fragColor = vec4(color, 1.0);
}
`;

/** The uniform names the renderer must look up — kept as one list so the
 * shader source and the renderer's uniform-location cache can't drift apart
 * silently (a typo in either place fails a unit test instead of a runtime
 * "uniform not found" warning). */
export const CRT_UNIFORM_NAMES = [
  "u_frame",
  "u_scanlineAmount",
  "u_curvatureAmount",
  "u_colorBleedAmount",
  "u_vignetteAmount",
  "u_resolution",
] as const;

export type CrtUniformName = (typeof CRT_UNIFORM_NAMES)[number];

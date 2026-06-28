// Motion guard (v0.4 W43).
//
// Locks in the single-motion-source invariant established by the Motion release:
//
//  1. No raw Framer spring/stagger/duration literals in components — every
//     `stiffness:` / `damping:` / `staggerChildren:` / `duration: 0.x` must live
//     in src/lib/motion.ts (the one place motion is tuned). Components import
//     DUR / SPRING / variants instead.
//  2. The app honours reduced motion centrally: App.tsx wraps the tree in
//     <MotionConfig reducedMotion="user"> and theme/motion.css carries the
//     global prefers-reduced-motion rule.
//  3. The motion preset module exports the shared vocabulary.
//
// Runs under vitest (see vitest.config.ts `include`).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const MOTION_SOURCE = join(SRC, "lib/motion.ts");

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

// Raw motion-tuning literals that belong only in lib/motion.ts.
const RAW = /\b(?:stiffness|damping|staggerChildren)\s*:|duration:\s*0\.\d/g;

describe("motion single-source (v0.4 W43)", () => {
  it("has no raw spring/stagger/duration literals outside src/lib/motion.ts", () => {
    const offenders = [];
    for (const file of walk(SRC, [".ts", ".tsx"])) {
      if (file === MOTION_SOURCE) continue;
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const hits = readFileSync(file, "utf8").match(RAW);
      if (hits) offenders.push(`${file}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("wraps the app in MotionConfig reducedMotion=\"user\"", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app.includes("MotionConfig")).toBe(true);
    expect(app.includes('reducedMotion="user"')).toBe(true);
  });

  it("carries the global reduced-motion rule in theme/motion.css", () => {
    const css = readFileSync(join(SRC, "theme/motion.css"), "utf8");
    expect(css.includes("prefers-reduced-motion: reduce")).toBe(true);
    expect(css.includes("--harmony-dur-fast")).toBe(true);
  });

  it("exports the shared motion presets", () => {
    const src = readFileSync(MOTION_SOURCE, "utf8");
    for (const name of [
      "export const DUR",
      "export const SPRING",
      "export const listContainer",
      "export const listItem",
      "export const pageTransition",
    ]) {
      expect(src.includes(name), `missing ${name}`).toBe(true);
    }
  });
});

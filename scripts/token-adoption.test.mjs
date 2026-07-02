// Token-adoption guard (v0.3 W33).
//
// Locks in the design-token invariants established by the Resonance release so a
// later change cannot silently reintroduce hard-coded colours:
//
//  1. No `var(--aura-*, <literal>)` colour fallbacks anywhere in src/ — every
//     token must resolve to a real declared value (the fallback masked an
//     undefined token, e.g. --aura-error, which is now aliased in aura-theme.css).
//  2. No bare hex colour literals in the structural style surfaces (library.css,
//     cores.css, App.tsx). Colours there must come through tokens. The theme
//     token-definition file (aura-theme.css) is exempt — it legitimately holds
//     the OKLCH source values.
//
// Runs under vitest (see vitest.config.ts `include`).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Recursively collect files under dir matching one of the extensions. */
function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// var(--aura-NAME, <hex|rgb|rgba literal>) — the banned colour-fallback shape.
const FALLBACK = /var\(\s*--aura-[a-z0-9-]+\s*,\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*\)/g;

describe("token adoption (v0.3 W33)", () => {
  it("has no var(--aura-*, <colour literal>) fallbacks anywhere in src/", () => {
    const offenders = [];
    for (const file of walk(SRC, [".ts", ".tsx", ".css"])) {
      const hits = readFileSync(file, "utf8").match(FALLBACK);
      if (hits) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("has no bare hex colours in the tokenized structural surfaces", () => {
    const surfaces = [
      "features/library/library.css",
      "features/cores/cores.css",
      "App.tsx",
    ].map((rel) => join(SRC, rel));
    const HEX = /#[0-9a-fA-F]{3,8}\b/g;
    const offenders = [];
    for (const file of surfaces) {
      const hits = readFileSync(file, "utf8").match(HEX);
      if (hits) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("declares the Retro Game Player token layer in aura-theme.css", () => {
    const theme = readFileSync(join(SRC, "theme/aura-theme.css"), "utf8");
    for (const token of [
      "--rgp-focus-ring",
      "--rgp-section-gap",
      "--rgp-font-hero-title",
      "--rgp-tile-min-width",
      "--aura-error",
    ]) {
      expect(theme.includes(`${token}:`), `missing ${token}`).toBe(true);
    }
  });
});

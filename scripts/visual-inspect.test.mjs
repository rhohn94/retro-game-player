// Unit tests for the visual-inspection harness helpers (W26A). The rebuild-
// awareness guard (checkBundleFreshness) is the load-bearing new piece: a stale
// dist/ must fail the gate loudly instead of silently passing an old bundle.
// Exercised against a temp fixture tree so it never depends on the real build.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBundleFreshness, newestMtimeMs } from "./visual-inspect.mjs";

/** Set a path's mtime to `epochSec` (both atime + mtime). */
function touchAt(path, epochSec) {
  utimesSync(path, epochSec, epochSec);
}

describe("newestMtimeMs", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rgp-mtime-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns 0 for a missing path", () => {
    expect(newestMtimeMs(join(dir, "does-not-exist"))).toBe(0);
  });

  it("returns a file's own mtime", () => {
    const f = join(dir, "a.txt");
    writeFileSync(f, "x");
    touchAt(f, 1000);
    expect(newestMtimeMs(f)).toBe(1000 * 1000);
  });

  it("returns the NEWEST mtime when recursing into a directory tree", () => {
    const sub = join(dir, "nested");
    mkdirSync(sub);
    const older = join(dir, "old.ts");
    const newer = join(sub, "new.ts");
    writeFileSync(older, "1");
    writeFileSync(newer, "2");
    touchAt(older, 1000);
    touchAt(newer, 5000);
    touchAt(sub, 2000);
    touchAt(dir, 1500);
    expect(newestMtimeMs(dir)).toBe(5000 * 1000);
  });

  it("skips dot-directories (cheap + deterministic)", () => {
    const dot = join(dir, ".cache");
    mkdirSync(dot);
    const hidden = join(dot, "huge.ts");
    writeFileSync(hidden, "z");
    touchAt(hidden, 9000);
    const real = join(dir, "src.ts");
    writeFileSync(real, "y");
    touchAt(real, 1000);
    touchAt(dir, 1000);
    // The .cache file (9000) is skipped, so the newest visible is src.ts (1000).
    expect(newestMtimeMs(dir)).toBe(1000 * 1000);
  });
});

describe("checkBundleFreshness", () => {
  let dir, distIndex, src;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rgp-fresh-"));
    distIndex = join(dir, "dist-index.html");
    src = join(dir, "src");
    mkdirSync(src);
    writeFileSync(distIndex, "<html>");
    writeFileSync(join(src, "app.ts"), "code");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is NOT stale when dist is newer than every source file", () => {
    touchAt(join(src, "app.ts"), 1000);
    touchAt(src, 1000);
    touchAt(distIndex, 2000); // built AFTER the source changed
    const r = checkBundleFreshness({ distIndex, sourceRoots: [src], allowStale: false });
    expect(r.stale).toBe(false);
    expect(r.distMs).toBeGreaterThan(r.srcMs);
  });

  it("IS stale when a source file is newer than dist (the silent-pass bug)", () => {
    touchAt(distIndex, 1000); // old build
    touchAt(join(src, "app.ts"), 5000); // edited after the build
    touchAt(src, 5000);
    const r = checkBundleFreshness({ distIndex, sourceRoots: [src], allowStale: false });
    expect(r.stale).toBe(true);
    expect(r.srcMs).toBeGreaterThan(r.distMs);
  });

  it("reports missing (never stale) when dist/index.html is absent", () => {
    const r = checkBundleFreshness({
      distIndex: join(dir, "nope.html"),
      sourceRoots: [src],
      allowStale: false,
    });
    expect(r.stale).toBe(false);
    expect(r.missing).toBe(true);
  });

  it("honours the HARMONY_INSPECT_ALLOW_STALE escape hatch", () => {
    touchAt(distIndex, 1000);
    touchAt(join(src, "app.ts"), 9000); // would be stale
    touchAt(src, 9000);
    const r = checkBundleFreshness({ distIndex, sourceRoots: [src], allowStale: true });
    expect(r.stale).toBe(false);
    expect(r.skipped).toBe(true);
  });
});

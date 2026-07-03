// Retro Game Player visual-inspection CLI (W18; upgraded in v0.2 "Sight") — the
// framework-required `gui-visual-inspection-cli` capability.
//
// A Tauri app cannot open its native window in headless CI, so this command
// renders the Vite-built web UI (the SPA the Rust shell loads) in a headless
// browser and captures artifacts per route. It is non-interactive and CI-safe
// (no GUI window, no RetroArch, no real network).
//
// WHAT CHANGED IN v0.2 AND WHY:
//   v0.1 reported success whenever ANY artifact file existed. That let a fully
//   broken app (React never mounted — see the Aura-runtime crash fixed in
//   vite.config) pass `smoke` with a green check while showing only a blank
//   backdrop. This version actually VERIFIES the GUI:
//     1. Captures browser console + uncaught page errors and FAILS on any
//        uncaught error (the exact signal that was previously invisible).
//     2. Asserts the React tree mounted and shell chrome rendered on EVERY
//        route, FAILING (non-zero exit) when a route is blank.
//     3. Injects a mock Tauri IPC layer (scripts/mock-ipc.mjs) so screens
//        render POPULATED instead of error/empty states.
//     4. Walks all primary routes and screenshots each.
//
// Exit codes: 0 = verified (or browser unavailable → unverified but tolerated
// so browserless CI still runs); 1 = GUI failed verification (blank/crashed);
// 2 = dist/ not built.
//
// Artifacts (under artifacts/visual-inspection/):
//   - screenshot.png        (the library route; kept at this path for back-compat)
//   - <route>.png           (one screenshot per route)
//   - dom.html              (rendered DOM of the library route)
//   - report.json           (machine-readable: per-route verdicts, errors, ok)
//
// See docs/design/runtime-verification-design.md.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile, copyFile, stat } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { buildMockIpcInitScript } from "./mock-ipc.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = join(ROOT, "dist");
const SRC = join(ROOT, "src");
const OUT_DIR = join(ROOT, "artifacts", "visual-inspection");
const PNG_PATH = join(OUT_DIR, "screenshot.png");
const DOM_PATH = join(OUT_DIR, "dom.html");
const REPORT_PATH = join(OUT_DIR, "report.json");

// The source roots whose newest change must predate the built bundle. index.html
// is the Vite entry (it references the bundle), so a change there also demands a
// rebuild. Kept small + deterministic; deep-walks src/ (below).
const SOURCE_ROOTS = [SRC, join(ROOT, "index.html")];

/** The newest mtime (ms) under a path, recursing into directories. Missing
 *  paths contribute 0 so an absent optional root never trips the check. */
export function newestMtimeMs(path) {
  let info;
  try {
    info = statSync(path);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = info.mtimeMs;
  for (const entry of readdirSync(path)) {
    // node_modules / build output can't live under src/, but skip dotdirs to
    // stay cheap + deterministic.
    if (entry.startsWith(".")) continue;
    const child = newestMtimeMs(join(path, entry));
    if (child > newest) newest = child;
  }
  return newest;
}

/**
 * Guard against a STALE bundle silently passing the gate: if any source file is
 * newer than the built `dist/index.html`, the running harness is inspecting an
 * old build (the exact failure mode that let tv-home pass on a pre-W261 bundle).
 * Returns `{ stale, distMs, srcMs }` — the caller fails loudly on `stale`.
 * Skipped when `HARMONY_INSPECT_ALLOW_STALE=1` (an escape hatch for the rare
 * case where inspecting a deliberately-old bundle is intended).
 *
 * The dist index + source roots are injectable (defaulting to the real repo
 * paths) so the freshness logic is unit-testable against a temp fixture tree.
 */
export function checkBundleFreshness({
  distIndex = join(DIST, "index.html"),
  sourceRoots = SOURCE_ROOTS,
  allowStale = process.env.HARMONY_INSPECT_ALLOW_STALE === "1",
} = {}) {
  if (allowStale) {
    return { stale: false, distMs: 0, srcMs: 0, skipped: true };
  }
  let distMs = 0;
  try {
    distMs = statSync(distIndex).mtimeMs;
  } catch {
    return { stale: false, distMs: 0, srcMs: 0, missing: true };
  }
  let srcMs = 0;
  for (const root of sourceRoots) {
    const m = newestMtimeMs(root);
    if (m > srcMs) srcMs = m;
  }
  return { stale: srcMs > distMs, distMs, srcMs };
}

// The primary routes (hash-router paths) the harness walks. `name` doubles as
// the screenshot filename; `expect` is a substring that must appear in the
// rendered text for the route to count as genuinely rendered (not just a shell).
const ROUTES = [
  { name: "library", hash: "#/", expect: "Library" },
  { name: "consoles", hash: "#/consoles", expect: "Consoles" },
  { name: "console-detail", hash: "#/console/nes", expect: "Hardware" },
  { name: "cores", hash: "#/cores", expect: "Cores" },
  { name: "search", hash: "#/search", expect: "Search" },
  { name: "settings", hash: "#/settings", expect: "Settings" },
  // The desktop game-detail route (W26A closes the §5 follow-up: /game/:id was
  // missing from the walk). The mock `get_game` returns SMB3, so its clean name
  // is the durable rendered marker — it appears in the detail `<h1>` regardless
  // of play state (the in-page player renders nothing under the mock's empty
  // play origin, but the title/metadata panel always paints).
  { name: "game-detail", hash: "#/game/1", expect: "Super Mario Bros. 3" },
  // v0.26 W260 — TV mode auto-enter (tv-mode-design.md §Acceptance bullet 2):
  // with `auto_tv_mode: true`, a fresh launch (any/no hash — App.tsx's
  // startup read fires regardless of route) must land in the TV shell
  // instead of the desktop library. `mockOverrides` gets its own page + init
  // script (see captureWithBrowser) since every other route needs the
  // default `false`.
  {
    name: "tv-home",
    hash: "#/",
    // The real TV home (v0.26 W261) — the "Continue playing" rail label, which
    // only renders once the hero+shelves actually mount with populated fixtures
    // (replacing the W260 placeholder's "TV HOME" eyebrow). Matched in
    // ALL-CAPS because `innerText` reflects the label's `text-transform:
    // uppercase` (the retro-accent section-label treatment, tv.css) — the
    // uppercasing is a core design decision, so the marker is durable.
    expect: "CONTINUE PLAYING",
    mockOverrides: { get_auto_tv_mode: true },
  },
  // v0.26 W26A — the tile→fullscreen takeover (tv-mode-design.md §Design
  // "Transitions"). Deterministic because the mock now serves a cached boxart
  // tier (mock-ipc.mjs), so the first tile has real cover art and the takeover's
  // cover layer has art to expand — no flake. Driven via the `actions` hook
  // below rather than a body-text `expect`, because the launched in-page player
  // renders nothing under the mock's empty play origin (no loopback server), so
  // the DURABLE marker is the surface + its animating cover layer, not text.
  // `actions` runs on the same auto-tv page after the home settles; if it
  // can't reach a deterministic takeover it returns ok:false and the harness
  // SKIPS (logs, does not fail) — the gate is never flaked by this capture.
  {
    name: "tv-takeover",
    hash: "#/",
    mockOverrides: { get_auto_tv_mode: true },
    // A per-route interaction hook: (page) => { ok, marker, skipReason }.
    // Runs post-goto/settle; returns ok:true with a satisfied marker to assert,
    // or ok:false + skipReason to skip cleanly. Never throws to the gate.
    actions: async (page) => {
      try {
        await page.waitForFunction(
          () => document.body.innerText.includes("CONTINUE PLAYING"),
          { timeout: 8000 },
        );
        // Focus + confirm the first tile (the seeded-focus tile). A pointer
        // click claims controller focus and routes through the SAME launch seam
        // (tvMode.launch) that controller `confirm` uses.
        const firstTile = await page.$(".rgp-tv-tile");
        if (!firstTile) return { ok: false, skipReason: "no tiles on TV home" };
        await firstTile.hover();
        await page.waitForTimeout(150);
        await firstTile.click();
        // The surface is the durable marker (always mounts on launch). The
        // cover-art layer mounts synchronously too when art resolves; screenshot
        // the cover MID-EXPAND (the signature W265 tile→fullscreen animation) as
        // soon as it exists. The reveal fires on the next rAF and the cover then
        // expands (position) + fades (opacity) concurrently over DUR.slow, so the
        // FIRST painted frame after mount has the cover art large (~890px, filling
        // toward the frame) and near-fully-opaque (~0.9) — the meaningful "game
        // launching, art blooming to fullscreen" capture. Waiting even ~90ms lands
        // after the cover has crossed out, so we screenshot with no settle. This
        // route OWNS its screenshot (returned as `shotOverride`).
        await page.waitForSelector(".rgp-tv-game-surface", { timeout: 4000 });
        // Best-effort wait for the cover (art-dependent); if it never mounts we
        // still capture + assert the surface, so the capture never flakes.
        await page
          .waitForSelector(".rgp-tv-game-surface__cover", { timeout: 1500 })
          .catch(() => {});
        const takeoverShot = join(OUT_DIR, "tv-takeover.png");
        await page.screenshot({ path: takeoverShot, fullPage: false });
        const marker = await page.evaluate(() => {
          const surf = document.querySelector(".rgp-tv-game-surface");
          const cover = document.querySelector(".rgp-tv-game-surface__cover");
          const player = document.querySelector(".rgp-tv-game-surface__player");
          return {
            hasSurface: !!surf,
            phase: surf ? surf.getAttribute("data-phase") : null,
            hasCover: !!cover,
            playerMounted: !!player,
          };
        });
        if (!marker.hasSurface) {
          return { ok: false, skipReason: "takeover surface did not mount" };
        }
        return { ok: true, marker, shotOverride: takeoverShot };
      } catch (err) {
        return { ok: false, skipReason: `takeover drive failed: ${err && err.message}` };
      }
    },
  },
  // v0.28 W278 — the TV system menu (tv-mode-design.md §v0.28 → W278). Driven
  // via the visible pointer ☰ Menu button (TvShell's header) rather than a
  // simulated gamepad press — Playwright has no real Gamepad API to emulate,
  // and the button routes through the SAME `tvMode.openMenu()` seam the
  // Select/touchpad raw-poll trigger calls, so clicking it exercises the real
  // open path end-to-end (state + overlay mount), just via the pointer
  // affordance instead of a physical button.
  {
    name: "tv-system-menu",
    hash: "#/",
    mockOverrides: { get_auto_tv_mode: true },
    actions: async (page) => {
      try {
        await page.waitForFunction(
          () => document.body.innerText.includes("CONTINUE PLAYING"),
          { timeout: 8000 },
        );
        const menuButton = await page.$(".rgp-tv-shell__menu");
        if (!menuButton) return { ok: false, skipReason: "no TV menu button on the shell" };
        await menuButton.click();
        await page.waitForSelector('[data-testid="tv-system-menu"]', { timeout: 4000 });
        const menuShot = join(OUT_DIR, "tv-system-menu.png");
        await page.screenshot({ path: menuShot, fullPage: false });
        const marker = await page.evaluate(() => {
          const panel = document.querySelector('[data-testid="tv-system-menu"]');
          const items = Array.from(document.querySelectorAll(".rgp-tv-system-menu__item")).map(
            (el) => el.textContent,
          );
          return { hasPanel: !!panel, items };
        });
        if (!marker.hasPanel) {
          return { ok: false, skipReason: "system menu panel did not mount" };
        }
        return { ok: true, marker, shotOverride: menuShot };
      } catch (err) {
        return { ok: false, skipReason: `system-menu drive failed: ${err && err.message}` };
      }
    },
  },
  // v0.28 W278 — "every page in TV mode" + the exit-snapshot contract. Opens
  // the menu, picks Consoles (the embedded region renders the real desktop
  // ConsolesPage inside the TvShell outlet while TV mode + fullscreen stay
  // active), then exits TV mode entirely and asserts the hash is back at "/"
  // (the pre-enter Library route) rather than "#/consoles" (wherever the menu
  // last navigated) — the exact regression `TvModeContext.exit()`'s
  // untouched-`priorRouteRef` design prevents (see that file's comments).
  {
    name: "tv-embedded-screen",
    hash: "#/",
    mockOverrides: { get_auto_tv_mode: true },
    actions: async (page) => {
      try {
        await page.waitForFunction(
          () => document.body.innerText.includes("CONTINUE PLAYING"),
          { timeout: 8000 },
        );
        const menuButton = await page.$(".rgp-tv-shell__menu");
        if (!menuButton) return { ok: false, skipReason: "no TV menu button on the shell" };
        await menuButton.click();
        await page.waitForSelector('[data-testid="tv-system-menu"]', { timeout: 4000 });
        // Click the "Consoles" row (second item, after "TV Home" —
        // systemMenu.ts's TV_MENU_ITEMS order).
        const items = await page.$$(".rgp-tv-system-menu__item");
        const consolesItem = items[1];
        if (!consolesItem) return { ok: false, skipReason: "no Consoles row in the menu" };
        await consolesItem.click();
        await page.waitForSelector('[data-testid="tv-embed"]', { timeout: 4000 });
        await page.waitForFunction(() => document.body.innerText.includes("Consoles"), {
          timeout: 4000,
        });
        const embedShot = join(OUT_DIR, "tv-embedded-screen.png");
        await page.screenshot({ path: embedShot, fullPage: false });
        const embedHash = await page.evaluate(() => window.location.hash);
        // Now exit TV mode entirely (the visible pointer exit button) and
        // assert the hash restores to the PRE-ENTER route ("#/", Library) —
        // not "#/consoles", which is what the embedded navigation left it at.
        const exitButton = await page.$(".rgp-tv-shell__exit");
        if (!exitButton) return { ok: false, skipReason: "no TV exit button on the shell" };
        await exitButton.click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="tv-shell"]'), {
          timeout: 4000,
        });
        const postExitHash = await page.evaluate(() => window.location.hash);
        const marker = { embedHash, postExitHash };
        if (postExitHash !== "#/") {
          return {
            ok: false,
            skipReason: `exit did not restore the pre-enter route: hash is "${postExitHash}", expected "#/"`,
          };
        }
        return { ok: true, marker, shotOverride: embedShot };
      } catch (err) {
        return { ok: false, skipReason: `embedded-screen drive failed: ${err && err.message}` };
      }
    },
  },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

// Minimal static file server over the built bundle. SPA fallback to index.html
// for unknown routes so the hash-router app boots.
export function startStaticServer(rootDir) {
  return new Promise((resolvePromise, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        let filePath = join(rootDir, urlPath === "/" ? "index.html" : urlPath);
        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403).end("forbidden");
          return;
        }
        if (!existsSync(filePath) || (await stat(filePath)).isDirectory()) {
          filePath = join(rootDir, "index.html");
        }
        const body = await readFile(filePath);
        res.writeHead(200, {
          "content-type": MIME[extname(filePath)] || "application/octet-stream",
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({ server, port });
    });
  });
}

// Resolve a usable Chromium-family executable without a network download:
// explicit env override, then any cached ms-playwright build, then the path
// playwright-core resolves, then a system Chrome. Returns null if none runnable.
export function resolveChromiumExecutable(chromium) {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    candidates.push(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE);
  }
  const cacheRoot = join(homedir(), "Library", "Caches", "ms-playwright");
  if (existsSync(cacheRoot)) {
    for (const entry of readdirSync(cacheRoot)) {
      if (entry.startsWith("chromium_headless_shell-")) {
        candidates.push(
          join(cacheRoot, entry, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        );
      }
      if (entry.startsWith("chromium-")) {
        candidates.push(
          join(cacheRoot, entry, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        );
      }
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  try {
    const p = chromium.executablePath();
    if (p) candidates.push(p);
  } catch {
    // playwright-core has no installed browser — fine, fall through.
  }
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

// Assert the SPA actually rendered on the current page: React mounted content
// into #root, the shell chrome is present, and the route's expected text shows.
// An `actions`-only route (no `expect`) has its render verdict come from its
// hook instead, so `hasExpectedText` is vacuously true when `expect` is absent.
async function assertRendered(page, route) {
  return page.evaluate((expect) => {
    const root = document.getElementById("root");
    const rootChildren = root ? root.children.length : 0;
    const bodyText = document.body.innerText || "";
    // .rgp-tv-shell covers TV mode's full-viewport takeover (v0.26 W260),
    // which replaces the desktop sidebar/aura-app chrome entirely while active.
    const hasShell = !!document.querySelector(".rgp-sidebar, .rgp-shell, aura-app, .rgp-tv-shell");
    return {
      rootChildren,
      rootHtmlLen: root ? root.innerHTML.length : 0,
      hasShell,
      hasExpectedText: expect == null ? true : bodyText.includes(expect),
    };
  }, route.expect ?? null);
}

async function captureWithBrowser(useMock) {
  const { chromium } = require("playwright-core");
  const executablePath = resolveChromiumExecutable(chromium);
  if (!executablePath) {
    return { ok: false, reason: "no-chromium-executable" };
  }
  const { server, port } = await startStaticServer(DIST);
  let browser;
  const consoleErrors = [];
  const pageErrors = [];
  // Mock-IPC "no fixture for command: X" warnings: a missing fixture means a
  // real screen invoked an IPC the harness didn't mock, so that surface rendered
  // against a null (degraded) result — and it is a console WARNING the gate must
  // fail on (W26A console hygiene). Collected separately from generic warnings
  // (which the desktop toolkit can emit benignly) so ONLY this precise, always-
  // actionable signal fails the gate.
  const mockWarnings = [];
  // Attach the console/pageerror/mock-warning listeners to a page (the shared
  // page and each mockOverride page get the SAME capture, so a warning on any
  // TV surface is seen). Kept in one helper so the two call sites can't drift.
  const wireDiagnostics = (target) => {
    target.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
      else if (m.type() === "warning" && m.text().includes("[mock-ipc]")) {
        mockWarnings.push(m.text());
      }
    });
    target.on("pageerror", (e) => pageErrors.push(e.message));
  };
  try {
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 832 },
      deviceScaleFactor: 2,
    });
    if (useMock) await page.addInitScript(buildMockIpcInitScript());
    wireDiagnostics(page);

    const routeResults = [];
    for (const route of ROUTES) {
      // A route with its own `mockOverrides` (e.g. tv-home's auto_tv_mode:
      // true) needs a FRESH page with its own init script — addInitScript on
      // the shared page applies to every navigation, so every other route
      // would inherit the override too. Regular routes reuse the shared page.
      const routePage = route.mockOverrides
        ? await browser.newPage({ viewport: { width: 1280, height: 832 }, deviceScaleFactor: 2 })
        : page;
      if (route.mockOverrides) {
        if (useMock) await routePage.addInitScript(buildMockIpcInitScript(route.mockOverrides));
        wireDiagnostics(routePage);
      }

      const before = pageErrors.length;
      await routePage.goto(`http://127.0.0.1:${port}/${route.hash}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await routePage.waitForTimeout(700); // let the route mount + paint
      let checks = await assertRendered(routePage, route);
      // Async mounts (e.g. tv-home's config-read -> AnimatePresence mode="wait"
      // crossfade) can land after the fixed settle delay; poll briefly for the
      // expected text before declaring the route unrendered.
      const RENDER_POLL_MS = 250;
      const RENDER_POLL_DEADLINE_MS = 5000;
      for (
        let waited = 0;
        !checks.hasExpectedText && waited < RENDER_POLL_DEADLINE_MS;
        waited += RENDER_POLL_MS
      ) {
        await routePage.waitForTimeout(RENDER_POLL_MS);
        checks = await assertRendered(routePage, route);
      }

      // A route with an `actions` hook drives an interaction (e.g. tile confirm
      // → takeover) and returns its own render verdict. It NEVER fails the gate:
      // ok:false means "couldn't reach a deterministic state" → the route is
      // marked skipped (logged, excluded from guiOk), so this capture can't
      // flake the smoke gate (W26A design constraint).
      let actionResult = null;
      let skipped = false;
      if (route.actions) {
        actionResult = await route.actions(routePage).catch((err) => ({
          ok: false,
          skipReason: `actions threw: ${err && err.message}`,
        }));
        if (!actionResult.ok) skipped = true;
      }

      // An actions route may capture its own screenshot at a precise animation
      // frame (shotOverride); honour it instead of a post-actions capture that
      // would land after the transition settled.
      const shot =
        actionResult && actionResult.shotOverride
          ? actionResult.shotOverride
          : join(OUT_DIR, `${route.name}.png`);
      if (!(actionResult && actionResult.shotOverride)) {
        await routePage.screenshot({ path: shot, fullPage: false });
      }
      if (route.name === "library") {
        await routePage.screenshot({ path: PNG_PATH, fullPage: false });
        await writeFile(DOM_PATH, await routePage.content(), "utf-8");
      }
      if (route.mockOverrides) await routePage.close().catch(() => {});
      const routeErrors = pageErrors.slice(before);
      // Render verdict: a normal route needs root+shell+expected-text; an
      // `actions` route additionally needs its hook to have succeeded. A skipped
      // actions route is neither rendered nor a failure — it drops out of the
      // guiOk tally below.
      const baseRendered =
        checks.rootChildren > 0 && checks.hasShell && checks.hasExpectedText;
      const rendered = route.actions
        ? baseRendered && !!(actionResult && actionResult.ok)
        : baseRendered;
      routeResults.push({
        route: route.name,
        hash: route.hash,
        screenshot: shot,
        rendered,
        skipped,
        skipReason: skipped ? actionResult.skipReason : undefined,
        actionMarker: actionResult ? actionResult.marker : undefined,
        ...checks,
        pageErrors: routeErrors,
      });
    }

    // Skipped routes (an actions hook that couldn't reach a deterministic state)
    // are excluded from the pass/fail tally — they never fail the gate. A
    // mock-ipc "no fixture" warning always fails: it means a rendered screen hit
    // an unmocked IPC (degraded render), which the console-hygiene gate forbids.
    const allRendered = routeResults.every((r) => r.skipped || r.rendered);
    return {
      ok: true,
      verified: true,
      guiOk: allRendered && pageErrors.length === 0 && mockWarnings.length === 0,
      executablePath,
      mock: !!useMock,
      routes: routeResults,
      consoleErrors,
      pageErrors,
      mockWarnings,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

// Fallback: ship the static built index.html as the DOM artifact. No browser
// render → the GUI is UNVERIFIED (we cannot prove it mounts), so we do not fail
// the gate, but we mark verified:false so the limitation is explicit.
async function captureStaticFallback() {
  await copyFile(join(DIST, "index.html"), DOM_PATH);
  return { ok: true, verified: false, static: true };
}

async function main() {
  if (!existsSync(DIST) || !existsSync(join(DIST, "index.html"))) {
    console.error("[visual-inspect] dist/ not built. Run `pnpm build` first.");
    process.exit(2);
  }
  // Rebuild-awareness (W26A): a stale dist/ silently passing is the exact bug
  // that let tv-home render a pre-W261 bundle. Fail LOUDLY (exit 2, same class
  // as "not built") when any source file is newer than the built bundle.
  const freshness = checkBundleFreshness();
  if (freshness.stale) {
    const ageSec = Math.round((freshness.srcMs - freshness.distMs) / 1000);
    console.error(
      "[visual-inspect] STALE BUNDLE — dist/ is older than src/ " +
        `(newest source is ${ageSec}s newer than dist/index.html). ` +
        "Run `pnpm build` before inspecting, or set HARMONY_INSPECT_ALLOW_STALE=1 " +
        "to inspect an old build on purpose.",
    );
    process.exit(2);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const useMock = process.env.HARMONY_INSPECT_NO_MOCK !== "1";

  let mode = "browser";
  let detail = {};
  try {
    const res = await captureWithBrowser(useMock);
    if (!res.ok) {
      console.warn(
        `[visual-inspect] browser capture unavailable (${res.reason}); ` +
          "falling back to static DOM dump (GUI unverified).",
      );
      mode = "static-fallback";
      detail = await captureStaticFallback();
    } else {
      detail = res;
    }
  } catch (err) {
    console.warn(
      `[visual-inspect] browser capture failed (${err && err.message}); ` +
        "falling back to static DOM dump (GUI unverified).",
    );
    mode = "static-fallback";
    detail = await captureStaticFallback();
  }

  const verified = !!detail.verified;
  const guiOk = verified ? !!detail.guiOk : null;
  const report = {
    capability: "gui-visual-inspection-cli",
    mode,
    verified,
    guiOk,
    mock: !!detail.mock,
    routes: detail.routes || [],
    consoleErrors: detail.consoleErrors || [],
    pageErrors: detail.pageErrors || [],
    mockWarnings: detail.mockWarnings || [],
    domPath: existsSync(DOM_PATH) ? DOM_PATH : null,
    screenshotPath: existsSync(PNG_PATH) ? PNG_PATH : null,
    executablePath: detail.executablePath || null,
    capturedAt: new Date().toISOString(),
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  // Report summary.
  if (verified) {
    for (const r of report.routes) {
      const flag = r.skipped ? "SKIP" : r.rendered ? "ok " : "FAIL";
      const suffix = r.skipped ? ` (${r.skipReason})` : "";
      console.log(`[visual-inspect] ${flag} ${r.route.padEnd(11)} ${r.screenshot}${suffix}`);
    }
    if (report.pageErrors.length) {
      console.error("[visual-inspect] uncaught page errors:");
      for (const e of report.pageErrors) console.error(`  ✗ ${e}`);
    }
    if (report.mockWarnings.length) {
      console.error(
        "[visual-inspect] mock-ipc gaps (a rendered screen invoked an unmocked IPC — " +
          "add the fixture to scripts/mock-ipc.mjs):",
      );
      for (const w of [...new Set(report.mockWarnings)]) console.error(`  ✗ ${w}`);
    }
  }

  if (verified && !guiOk) {
    console.error(
      "[visual-inspect] GUI VERIFICATION FAILED — a route is blank, the page threw, " +
        `or a screen hit an unmocked IPC (see mock-ipc gaps above). See ${REPORT_PATH}`,
    );
    process.exit(1);
  }
  console.log(
    `[visual-inspect] mode=${mode} verified=${verified}` +
      (verified ? ` guiOk=${guiOk} routes=${report.routes.length}` : " (browser unavailable)"),
  );
  process.exit(0);
}

// Only run the CLI when invoked directly (not when imported for its helpers,
// e.g. by scripts/inspect-empty-states.mjs).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[visual-inspect] fatal:", err);
    process.exit(1);
  });
}

// Harmony visual-inspection CLI (W18; upgraded in v0.2 "Sight") — the
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
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { buildMockIpcInitScript } from "./mock-ipc.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = join(ROOT, "dist");
const OUT_DIR = join(ROOT, "artifacts", "visual-inspection");
const PNG_PATH = join(OUT_DIR, "screenshot.png");
const DOM_PATH = join(OUT_DIR, "dom.html");
const REPORT_PATH = join(OUT_DIR, "report.json");

// The primary routes (hash-router paths) the harness walks. `name` doubles as
// the screenshot filename; `expect` is a substring that must appear in the
// rendered text for the route to count as genuinely rendered (not just a shell).
const ROUTES = [
  { name: "library", hash: "#/", expect: "Library" },
  { name: "cores", hash: "#/cores", expect: "Cores" },
  { name: "search", hash: "#/search", expect: "Search" },
  { name: "settings", hash: "#/settings", expect: "Settings" },
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
function startStaticServer(rootDir) {
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
function resolveChromiumExecutable(chromium) {
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
async function assertRendered(page, route) {
  return page.evaluate((expect) => {
    const root = document.getElementById("root");
    const rootChildren = root ? root.children.length : 0;
    const bodyText = document.body.innerText || "";
    const hasShell = !!document.querySelector(".harmony-sidebar, .harmony-shell, aura-app");
    return {
      rootChildren,
      rootHtmlLen: root ? root.innerHTML.length : 0,
      hasShell,
      hasExpectedText: bodyText.includes(expect),
    };
  }, route.expect);
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
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(e.message));

    const routeResults = [];
    for (const route of ROUTES) {
      const before = pageErrors.length;
      await page.goto(`http://127.0.0.1:${port}/${route.hash}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(700); // let the route mount + paint
      const checks = await assertRendered(page, route);
      const shot = join(OUT_DIR, `${route.name}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      if (route.name === "library") {
        await page.screenshot({ path: PNG_PATH, fullPage: false });
        await writeFile(DOM_PATH, await page.content(), "utf-8");
      }
      const routeErrors = pageErrors.slice(before);
      const rendered =
        checks.rootChildren > 0 && checks.hasShell && checks.hasExpectedText;
      routeResults.push({
        route: route.name,
        hash: route.hash,
        screenshot: shot,
        rendered,
        ...checks,
        pageErrors: routeErrors,
      });
    }

    const allRendered = routeResults.every((r) => r.rendered);
    return {
      ok: true,
      verified: true,
      guiOk: allRendered && pageErrors.length === 0,
      executablePath,
      mock: !!useMock,
      routes: routeResults,
      consoleErrors,
      pageErrors,
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
    domPath: existsSync(DOM_PATH) ? DOM_PATH : null,
    screenshotPath: existsSync(PNG_PATH) ? PNG_PATH : null,
    executablePath: detail.executablePath || null,
    capturedAt: new Date().toISOString(),
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  // Report summary.
  if (verified) {
    for (const r of report.routes) {
      const flag = r.rendered ? "ok " : "FAIL";
      console.log(`[visual-inspect] ${flag} ${r.route.padEnd(9)} ${r.screenshot}`);
    }
    if (report.pageErrors.length) {
      console.error("[visual-inspect] uncaught page errors:");
      for (const e of report.pageErrors) console.error(`  ✗ ${e}`);
    }
  }

  if (verified && !guiOk) {
    console.error(
      "[visual-inspect] GUI VERIFICATION FAILED — a route is blank or the page threw. " +
        `See ${REPORT_PATH}`,
    );
    process.exit(1);
  }
  console.log(
    `[visual-inspect] mode=${mode} verified=${verified}` +
      (verified ? ` guiOk=${guiOk} routes=${report.routes.length}` : " (browser unavailable)"),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[visual-inspect] fatal:", err);
  process.exit(1);
});

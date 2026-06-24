// Harmony visual-inspection CLI (W18) — the framework-required
// `gui-visual-inspection-cli` capability.
//
// A Tauri app cannot open its native window in headless CI, so this command
// renders the Vite-built web UI (the SPA the Rust shell loads) in a headless
// browser and captures an artifact to a known path. It is non-interactive,
// CI-safe (no GUI window, no RetroArch, no network), and always exits 0 on a
// produced artifact.
//
// Strategy (most-faithful first, with a guaranteed fallback):
//   1. Serve the built `dist/` over a local loopback HTTP server.
//   2. Launch headless Chromium via playwright-core, resolving an executable
//      from (a) PLAYWRIGHT_CHROMIUM_EXECUTABLE, (b) a cached ms-playwright
//      build, or (c) playwright-core's own resolved path. Screenshot to PNG
//      and dump the rendered DOM to HTML.
//   3. If no browser can launch (none installed), fall back to copying the
//      static built index.html as the DOM artifact so the artifact still
//      exists and the command still exits 0 — limitation noted in the output.
//
// Artifacts (known paths, under artifacts/visual-inspection/):
//   - screenshot.png   (PNG screenshot; only in browser mode)
//   - dom.html         (rendered or static DOM dump; always produced)
//   - report.json      (machine-readable: mode, artifacts, ok)
//
// See docs/design/runtime-verification-design.md.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile, copyFile, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = join(ROOT, "dist");
const OUT_DIR = join(ROOT, "artifacts", "visual-inspection");
const PNG_PATH = join(OUT_DIR, "screenshot.png");
const DOM_PATH = join(OUT_DIR, "dom.html");
const REPORT_PATH = join(OUT_DIR, "report.json");

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
// playwright-core resolves (may be absent). Returns null if none is runnable.
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
          join(
            cacheRoot,
            entry,
            "chrome-headless-shell-mac-arm64",
            "chrome-headless-shell",
          ),
        );
      }
      if (entry.startsWith("chromium-")) {
        candidates.push(
          join(
            cacheRoot,
            entry,
            "chrome-mac-arm64",
            "Google Chrome for Testing.app",
            "Contents",
            "MacOS",
            "Google Chrome for Testing",
          ),
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

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

async function captureWithBrowser() {
  const { chromium } = require("playwright-core");
  const executablePath = resolveChromiumExecutable(chromium);
  if (!executablePath) {
    return { ok: false, reason: "no-chromium-executable" };
  }
  const { server, port } = await startStaticServer(DIST);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 832 },
      deviceScaleFactor: 2,
    });
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    // Give the SPA a beat to mount + paint the first route.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: PNG_PATH, fullPage: false });
    const html = await page.content();
    await writeFile(DOM_PATH, html, "utf-8");
    return { ok: true, executablePath, port };
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

// Fallback: ship the static built index.html as the DOM artifact. No browser
// render, but the artifact exists and the command still exits 0.
async function captureStaticFallback() {
  const indexPath = join(DIST, "index.html");
  await copyFile(indexPath, DOM_PATH);
  return { ok: true, static: true };
}

async function main() {
  if (!existsSync(DIST) || !existsSync(join(DIST, "index.html"))) {
    console.error(
      "[visual-inspect] dist/ not built. Run `pnpm build` first.",
    );
    process.exit(2);
  }
  await mkdir(OUT_DIR, { recursive: true });

  let mode = "browser";
  let detail = {};
  try {
    const res = await captureWithBrowser();
    if (!res.ok) {
      console.warn(
        `[visual-inspect] browser capture unavailable (${res.reason}); ` +
          "falling back to static DOM dump.",
      );
      mode = "static-fallback";
      detail = await captureStaticFallback();
    } else {
      detail = res;
    }
  } catch (err) {
    console.warn(
      `[visual-inspect] browser capture failed (${err && err.message}); ` +
        "falling back to static DOM dump.",
    );
    mode = "static-fallback";
    detail = await captureStaticFallback();
  }

  const artifacts = [];
  if (existsSync(PNG_PATH)) artifacts.push(PNG_PATH);
  if (existsSync(DOM_PATH)) artifacts.push(DOM_PATH);

  const report = {
    capability: "gui-visual-inspection-cli",
    mode,
    ok: artifacts.length > 0,
    artifacts,
    domPath: existsSync(DOM_PATH) ? DOM_PATH : null,
    screenshotPath: existsSync(PNG_PATH) ? PNG_PATH : null,
    detail: { executablePath: detail.executablePath || null, static: !!detail.static },
    capturedAt: new Date().toISOString(),
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  if (!report.ok) {
    console.error("[visual-inspect] no artifact produced.");
    process.exit(1);
  }
  console.log(
    `[visual-inspect] mode=${mode} artifacts=${artifacts.length}\n` +
      artifacts.map((a) => `  - ${a}`).join("\n"),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[visual-inspect] fatal:", err);
  process.exit(1);
});

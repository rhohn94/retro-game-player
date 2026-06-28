// Empty-state visual capture (v0.5 W53) — screenshots the Library and
// Settings→Folders screens with EMPTY mock fixtures so the "Create a games
// folder for me" affordance is visible. Complements visual-inspect.mjs (which
// uses populated fixtures and so never shows the empty states).
//
// Reuses the static server + Chromium resolver exported from visual-inspect.mjs.
// Non-CI helper: prints where it wrote the PNGs; exits 1 only if it cannot
// render at all. Run after `pnpm build`.

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { buildMockIpcInitScript } from "./mock-ipc.mjs";
import { startStaticServer, resolveChromiumExecutable } from "./visual-inspect.mjs";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT_DIR = join(ROOT, "artifacts", "visual-inspection");

// Override the library + folder lists to empty so the empty states render.
const EMPTY = { list_games: [], list_content_folders: [] };

const SHOTS = [
  { name: "empty-library", hash: "#/", expect: "Create a games folder" },
  { name: "empty-settings-folders", hash: "#/settings", expect: "Create a games folder" },
];

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("[empty-states] dist/ not built. Run `pnpm build` first.");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const { chromium } = require("playwright-core");
  const executablePath = resolveChromiumExecutable(chromium);
  if (!executablePath) {
    console.warn("[empty-states] no Chromium executable; skipping (not a gate).");
    process.exit(0);
  }

  const { server, port } = await startStaticServer(DIST);
  let browser;
  let ok = true;
  try {
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 832 },
      deviceScaleFactor: 2,
    });
    await page.addInitScript(buildMockIpcInitScript(EMPTY));

    for (const shot of SHOTS) {
      await page.goto(`http://127.0.0.1:${port}/${shot.hash}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(700);
      const text = await page.evaluate(() => document.body.innerText || "");
      const found = text.includes(shot.expect);
      const out = join(OUT_DIR, `${shot.name}.png`);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`[empty-states] ${found ? "ok  " : "MISS"} ${shot.name.padEnd(24)} ${out}`);
      if (!found) ok = false;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[empty-states] fatal:", err);
  process.exit(1);
});

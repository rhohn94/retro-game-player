// Cores browse/search visual capture (v0.7 W73) — screenshots the Cores screen
// in its default per-system view and in browse-all/search mode (after typing a
// query), so the v0.7 discovery experience is verifiable. Reuses the static
// server + Chromium resolver exported from visual-inspect.mjs.
//
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

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("[cores] dist/ not built. Run `pnpm build` first.");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const { chromium } = require("playwright-core");
  const executablePath = resolveChromiumExecutable(chromium);
  if (!executablePath) {
    console.warn("[cores] no Chromium executable; skipping (not a gate).");
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
    await page.addInitScript(buildMockIpcInitScript());

    await page.goto(`http://127.0.0.1:${port}/#/cores`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT_DIR, "cores-browse.png") });
    console.log(`[cores] ok   cores-browse           ${join(OUT_DIR, "cores-browse.png")}`);

    // Type a query to enter browse-all/search mode and capture the results.
    await page.fill(".cores-search", "snes");
    await page.waitForTimeout(500);
    const text = await page.evaluate(() => document.body.innerText || "");
    const found = text.toLowerCase().includes("snes9x");
    await page.screenshot({ path: join(OUT_DIR, "cores-search.png") });
    console.log(`[cores] ${found ? "ok  " : "MISS"} cores-search (q=snes)  ${join(OUT_DIR, "cores-search.png")}`);
    if (!found) ok = false;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[cores] fatal:", err);
  process.exit(1);
});

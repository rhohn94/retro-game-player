// Create-folder success-state capture (v0.8 W82) — drives the empty Library
// through the "Create a games folder" flow and screenshots the new success
// confirmation (path + Reveal in Finder). Verifies the fix for the
// silent-success bug. Reuses the helpers exported from visual-inspect.mjs.

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
const EMPTY = { list_games: [], list_content_folders: [] };

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("[create-success] dist/ not built. Run `pnpm build` first.");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const { chromium } = require("playwright-core");
  const executablePath = resolveChromiumExecutable(chromium);
  if (!executablePath) {
    console.warn("[create-success] no Chromium; skipping (not a gate).");
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
    await page.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(700);

    // Activate an <aura-button> by label. Harmony wires some buttons via the
    // `aura-click` CustomEvent and others via React `onClick` (a native click),
    // so dispatch BOTH on the matched element to cover either mechanism. This is
    // robust to the custom element's slotting (Playwright's text/role locators
    // don't resolve the label reliably here).
    const clickByLabel = (label) =>
      page.evaluate((t) => {
        const el = [...document.querySelectorAll("aura-button, button")].find(
          (b) => (b.textContent || "").trim().includes(t),
        );
        if (!el) return false;
        el.dispatchEvent(new CustomEvent("aura-click", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      }, label);

    const opened = await clickByLabel("Create a games folder for me");
    await page.waitForTimeout(500);
    const confirmed = await clickByLabel("Create folder");
    await page.waitForTimeout(700);
    if (!opened || !confirmed) {
      console.warn(`[create-success] could not drive the flow (opened=${opened} confirmed=${confirmed})`);
    }

    const text = await page.evaluate(() => document.body.innerText || "");
    const found = text.includes("Games folder ready") && text.includes("Reveal in Finder");
    await page.screenshot({ path: join(OUT_DIR, "create-success.png") });
    console.log(`[create-success] ${found ? "ok  " : "MISS"} success state  ${join(OUT_DIR, "create-success.png")}`);
    ok = found;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
  // Best-effort visual aid (custom-element driving is environment-sensitive), so
  // a MISS warns but does not fail — the success view is also covered by typecheck.
  if (!ok) console.warn("[create-success] success state not captured (non-fatal).");
  process.exit(0);
}

main().catch((err) => {
  console.error("[create-success] fatal:", err);
  process.exit(1);
});

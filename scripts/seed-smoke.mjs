#!/usr/bin/env node
/**
 * Phase D — optional smoke probe of seeded search provider templates.
 * GETs each template with q=mario and reports empty / captcha / ok-ish.
 *
 * Usage: node scripts/seed-smoke.mjs
 * Network-only; not part of default CI.
 */

const SAMPLES = [
  ["DuckDuckGo", "https://html.duckduckgo.com/html/?q=mario"],
  ["Internet Archive", "https://archive.org/search?query=mario"],
  ["PDRoms", "https://www.pdroms.de/?s=mario"],
  ["RomsGames", "https://www.romsgames.net/?s=mario"],
];

const CAPTCHA = /captcha|cloudflare|just a moment|cf-browser-verification/i;

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Harmony-seed-smoke/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    const anchors = (text.match(/<a\s/gi) || []).length;
    let status = "ok";
    if (!res.ok) status = `http_${res.status}`;
    else if (CAPTCHA.test(text)) status = "captcha";
    else if (anchors < 3) status = "empty_or_js";
    console.log(`${status.padEnd(12)} ${String(ms).padStart(5)}ms  a=${String(anchors).padStart(3)}  ${name}`);
  } catch (e) {
    console.log(`error        ${String(Date.now() - t0).padStart(5)}ms  ${name}: ${e.message}`);
  }
}

console.log("Seed smoke (q=mario) — not CI; for manual trust checks\n");
for (const [name, url] of SAMPLES) {
  await probe(name, url);
}

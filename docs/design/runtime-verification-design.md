# Runtime Verification Design — Visual Inspection + Smoke (v0.1)

> **Up:** [↑ Design docs](README.md)

> **Status:** W18 deliverable. Documents Harmony's **visual-inspection CLI**
> (the framework-required `gui-visual-inspection-cli` capability — see
> [../roadmap.md](../roadmap.md) §Framework-required) and how the `smoke` recipe
> target exercises the served UI surface CI-safely. Consumes the build seam
> fixed in [architecture-design.md](architecture-design.md) and renders the UI
> language fixed in [ux/design-language.md](ux/design-language.md).

## Motivation

Harmony is a Tauri 2 app: a Rust shell hosting a Vite-built React SPA. The
native window cannot open in headless CI (no display server, no GPU surface),
so we cannot screenshot the real Tauri window there. But the **entire UI is the
web SPA** — the Rust shell only loads `dist/` over a custom protocol. So the
faithful, CI-safe way to visually inspect the app is to render that built bundle
in a headless browser and capture an artifact. This gives every downstream agent
and the merge gate a deterministic "did the UI render?" check without a GUI
window, RetroArch, or network access.

## Goals

- A **non-interactive** command that captures a render of the running app UI to
  a known file path and exits 0 on success.
- Produce a **real artifact**: a PNG screenshot when a headless browser is
  available, plus a DOM dump and a machine-readable report — always at least one
  artifact.
- Make `recipe.py smoke` **green** for the served UI surface: build the bundle,
  render it headlessly, and assert the artifact exists.
- CI-safe: no GUI window, no RetroArch, no network.

## Non-goals

- Screenshotting the real native Tauri window (not possible headless; deferred).
- Pixel-diff / visual-regression baselines (a later iteration may layer these on
  top of the captured PNG).
- Driving controller/gamepad input through the captured page.

## The visual-inspection CLI

Implementation: `scripts/visual-inspect.mjs`. Invoked as `node
scripts/visual-inspect.mjs`, or via the `inspect` recipe target, or
`pnpm inspect`. It assumes `dist/` is already built (exits 2 otherwise).

Pipeline:

1. **Serve** the built `dist/` over a loopback HTTP server (ephemeral port,
   `127.0.0.1` only). A minimal static server with SPA fallback to `index.html`
   so the hash-router app boots — no `vite preview`, no fixed port.
2. **Render** in headless Chromium via `playwright-core` (a devDependency that
   ships *no* browser binary — it drives an existing one). The executable is
   resolved without any network download, in priority order:
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE` → a cached `ms-playwright` build
   (`chromium_headless_shell-*` / `chromium-*`) → system Google Chrome →
   `playwright-core`'s own resolved path. The page is loaded, given a beat to
   mount and paint, then a PNG screenshot and the rendered DOM are captured.
3. **Fallback**: if no headless browser can be launched, the command copies the
   static built `index.html` as the DOM artifact so an artifact still exists and
   the command still exits 0. The report records `mode: "static-fallback"`. This
   keeps smoke green on machines with no browser; the limitation is that no live
   render/PNG is produced there.

Artifacts (under `artifacts/visual-inspection/`, git-ignored):

| File | When | Contents |
|---|---|---|
| `screenshot.png` | browser mode | PNG screenshot of the rendered SPA (1280×832 @2x) |
| `dom.html` | always | rendered DOM (browser mode) or static `index.html` (fallback) |
| `report.json` | always | `{capability, mode, ok, artifacts, screenshotPath, domPath, detail, capturedAt}` |

The command exits `0` on a produced artifact, `1` if none could be produced, and
`2` if `dist/` is missing.

## How smoke works

`recipe.py smoke` (`.claude/recipes.json` → `smoke`) chains, all CI-safe:

```
pnpm build                                         # build the web bundle (tsc + vite)
&& cargo check --manifest-path src-tauri/Cargo.toml # type-check the Rust shell
&& node scripts/visual-inspect.mjs                  # render the served UI, capture artifact
&& test -f artifacts/visual-inspection/dom.html     # assert the artifact exists
```

The `inspect` target is the capture alone (it runs `pnpm build` first for
standalone use). W1 owns the base recipe file; W18 extended the existing `smoke`
target and appended the `inspect` target — no existing target's command was
rewritten.

## Validation

On the development machine smoke runs in **browser mode**: a real ~0.8 MB PNG of
the Harmony shell (HeroBackdrop vibrancy over the routed first screen) plus the
rendered DOM and `report.json`. `pnpm build` and `pnpm typecheck` stay green.
The script is dependency-light (`playwright-core` + Node stdlib) and the static
fallback guarantees a green smoke even where no browser is installed.

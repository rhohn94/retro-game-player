# Harmony v0.1 — Remaining Work Tickets

> **Up:** [↑ Docs](README.md)


Filed 2026-06-24. These cover everything deferred from the v0.1 build session.
File as GitHub issues once the repo exists (W21-ship is a prerequisite for the issue tracker).

---

## T1 · W21-ship: Create GitHub repo, push branches + tag, cut v0.1 GitHub Release

**Labels:** `ship`, `v0.1`, `human-gated`
**Depends on:** nothing (first step)
**Blocks:** T2-dmg (DMG upload), T3-deploy-layout (symlink to published release)

### Context

Harmony v0.1 is fully built and merged locally. `main`, `dev`, and annotated tag `v0.1` all exist in the local repo at `/Users/roberthohn/Projects/Agentic Factory Projects/retro-game-player`. This ticket covers the human-gated ship step deferred during the build session.

**Pre-condition the agent must verify before acting:**
```
gh auth status          # must show authenticated user
git log --oneline -3    # confirm HEAD is the expected merge commit on version/0.1 or main
git tag -l v0.1         # must return v0.1
```

### Acceptance Criteria

1. Create the GitHub repo (no auto-init — local history will be pushed):
   ```
   gh repo create rhohn94/retro-game-player --public --source=. --remote=origin
   ```

2. **PAUSE HERE — ask the user to confirm before pushing.** Then push:
   ```
   git push origin dev main
   git push origin v0.1
   ```

3. Cut the GitHub Release:
   ```
   gh release create v0.1 \
     --title "Harmony v0.1 — Foundation" \
     --notes "Harmony is a polished Mac-native emulator frontend (Tauri 2 + React 19 + Aura design language). v0.1 ships the full Foundation layer: library scan, RetroArch launch, NES/SNES/N64 cores UI, metadata/art, search, Familiar AI integration, Fleet/Ensign telemetry, and a controller-first input layer. Notarized DMG to follow." \
     --target main
   ```

4. Verify:
   ```
   gh release view v0.1
   gh repo view rhohn94/retro-game-player
   ```

### Out of scope
- Notarized DMG upload (T2)
- Deployed-instance layout (T3)

---

## T2 · W21-dmg: Build and notarize arm64 DMG for Harmony v0.1

**Labels:** `ship`, `v0.1`, `human-gated`, `macos`
**Depends on:** T1 (repo must exist to upload the asset)

### Context

The v0.1 build session skipped the DMG because it requires an Apple Developer ID. This ticket covers the distributable build for macOS Apple Silicon.

**Pre-conditions the agent must verify before acting:**
```
security find-identity -v -p codesigning   # must list a "Developer ID Application" cert
echo $APPLE_ID $APPLE_TEAM_ID             # must be non-empty
```
If the identity is absent, document the gap in `docs/release-planning-v0.1.md` §Follow-ups and close as deferred.

### Acceptance Criteria

1. Build the release bundle:
   ```
   cd "/Users/roberthohn/Projects/Agentic Factory Projects/retro-game-player"
   pnpm tauri build --target aarch64-apple-darwin
   ```
   Expected output: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Harmony_*.dmg`

2. Notarize:
   ```
   DMG=$(ls src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg | head -1)
   xcrun notarytool submit "$DMG" \
     --apple-id "$APPLE_ID" \
     --password "$APPLE_PASSWORD" \
     --team-id "$APPLE_TEAM_ID" \
     --wait
   xcrun stapler staple "$DMG"
   ```

3. Verify:
   ```
   spctl --assess --type open --context context:primary-signature -v "$DMG"
   # must print: accepted
   ```

4. Upload to the v0.1 GitHub Release:
   ```
   gh release upload v0.1 "$DMG"
   ```

### Notes
- Tauri 2 can handle notarization automatically if `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`, and `APPLE_CERTIFICATE_PASSWORD` are set in the environment. Either approach (manual xcrun or Tauri-native) is acceptable.
- Do NOT commit credential env vars to the repo.

---

## T3 · W21-deploy-layout: Populate deployed-instance layout for v0.1.0

**Labels:** `v0.1`, `ops`, `local`
**Depends on:** nothing (local-machine task, no git commit needed)

### Context

The architecture contract (`docs/design/architecture-design.md` §4.2) defines a deployed-apps layout at `~/Projects/deployed-apps/harmony/`. The telemetry module writes `run.json` into `versions/v{version}/` on every launch, and Fleet/Ensign reads `fleet-instance.json` from the same dir. These static files must be seeded before the first production launch.

### Acceptance Criteria

1. Create the directory tree:
   ```
   mkdir -p ~/Projects/deployed-apps/harmony/versions/v0.1.0
   ```

2. Write `fleet-instance.json`:
   ```json
   {
     "schema_version": 1,
     "instance_id": "harmony-local-0",
     "app": "harmony",
     "version": "0.1.0",
     "env": "local",
     "ordinal": 0
   }
   ```
   Path: `~/Projects/deployed-apps/harmony/versions/v0.1.0/fleet-instance.json`

3. Write `grimoire-build-info.json` (substitute real values):
   ```json
   {
     "schema_version": 1,
     "app": "harmony",
     "version": "0.1.0",
     "built_at": "<ISO-8601 timestamp>",
     "git_sha": "<git rev-parse HEAD on main>"
   }
   ```
   Get `git_sha` with:
   ```
   git -C "/Users/roberthohn/Projects/Agentic Factory Projects/retro-game-player" rev-parse main
   ```
   Path: `~/Projects/deployed-apps/harmony/versions/v0.1.0/grimoire-build-info.json`

4. Create the `current` symlink:
   ```
   ln -sf versions/v0.1.0 ~/Projects/deployed-apps/harmony/current
   ```

5. Verify:
   ```
   ls -la ~/Projects/deployed-apps/harmony/current/
   # must resolve and show both JSON files
   ```

### Notes
- The telemetry module will write `run.json` here on first launch — this ticket seeds only the static files.
- Fleet/Ensign HTTP server (tiny_http on port 8420) reads `fleet-instance.json` to populate `/fleet/v1/status`. Missing file → server starts but returns empty instance data.

---

## T4 · follow-up: Add mock-IPC harness so visual-inspection smoke renders populated UI

**Labels:** `v0.2`, `testing`, `dx`
**Depends on:** nothing

### Context

The W18 visual-inspection CLI (`scripts/visual-inspect.mjs`) renders the built web bundle headlessly via Playwright. The Aura theme, brand gradient, and shell layout render correctly. However, `#root` content is empty because the headless browser has no Tauri IPC runtime — all `invoke()` calls silently fail, so screens that depend on backend data show nothing. Documented as a v0.2 follow-up during the build session.

### Acceptance Criteria

1. Create `scripts/mock-ipc.js` — injected into the headless browser before the app bundle loads. It must stub:
   - `window.__TAURI_INTERNALS__` and `window.__TAURI__` with the minimal surface the app uses.
   - `invoke(cmd, args)` → returns canned fixtures per command (see fixture table).
   - `event.listen` / `event.once` / `event.emit` → no-ops returning a cleanup function.

2. Update `scripts/visual-inspect.mjs` to inject the mock via Playwright `addInitScript` before the app loads.

3. The `smoke` recipe (`.claude/recipes.json` target `smoke`) must pass with the mock in place, and `artifacts/visual-inspection/dom.html` must contain at least one `<article>` or `<li>` rendered by LibraryPage.

4. Add a `§Mock IPC fixture table` section to `docs/design/architecture-design.md`.

### Fixture table (minimum viable)

| Command | Canned response |
|---|---|
| `get_library` | `{ "games": [] }` |
| `list_cores` | `{ "cores": [] }` |
| `search_games` | `{ "results": [] }` |
| `get_familiar_status` | `{ "status": "unconfigured" }` |
| `get_fleet_status` | `{ "instance_id": "harmony-local-0", "version": "0.1.0" }` |
| *(any other)* | `null` |

### Notes
- The mock must NOT be bundled into the production app — dev/CI only, injected via Playwright, never via `vite.config.ts`.
- Relevant files: `scripts/visual-inspect.mjs`, `scripts/mock-ipc.js` (new), `.claude/recipes.json`, `docs/design/architecture-design.md`.

---

## T5 · follow-up: Live-hardware gamepad verification for W14 controller layer

**Labels:** `v0.2`, `qa`, `manual`, `controller`
**Depends on:** T1 (app built, ideally running from a production bundle)

### Context

W14 implemented the controller layer using the browser Gamepad API, a semantic action layer, and norigin-style spatial navigation. Unit tests (31 vitest) cover action mapping and focus-graph logic, but live-hardware verification was explicitly deferred from the v0.1 build session.

### Setup (manual, one-time)
1. Connect a USB or Bluetooth gamepad (Xbox, DualSense, or 8BitDo recommended).
2. Run `pnpm tauri dev` from the project root.

### Verification steps

1. Open the app. Navigate to Library view (`/`).
2. Press D-pad up/down — focus ring must move between game cards with Aura focus styling.
3. Press A/Cross (confirm) on a focused card — must navigate to `/game/:id`.
4. Press B/Circle (cancel/back) from detail view — must return to library.
5. Navigate to Settings (`/settings`) via sidebar using D-pad or menu action.
6. In Settings, advance through Familiar URL and API key fields with D-pad down — focus must progress through form fields.
7. Verify no console errors related to `gamepadconnected` / `gamepaddisconnected`.

**Pass:** all 7 steps complete without focus loss, missed input, or console errors.

**Fail:** document the failing step (step number, button, observed vs. expected) as a comment and open a follow-up bug.

### Notes
- Gamepad API requires a user gesture before `navigator.getGamepads()` returns non-empty — pressing any button after launch is the gesture. W14 handles this via a `gamepadconnected` event listener.
- PromptFont/Xelu glyphs must display correctly for the connected controller type.
- Relevant source: `src/features/controller/`, `src/hooks/useGamepad.ts`.
- Controller index-mapping fixes go in `src/features/controller/mappings/` — never hardcoded in the hook.
- This is a manual QA task; Playwright gamepad emulation automation is v0.3+.

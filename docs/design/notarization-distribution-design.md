# Notarization & distribution

> **Up:** [↑ Design index](README.md)

## Motivation

v0.30 "Passport" theme: the app should be installable by "hands that aren't
the developer's." Today's release DMG (`pnpm tauri build`, `src-tauri/
tauri.conf.json` `bundle` block) is built **unsigned**. On any Mac other than
the one that built it, Gatekeeper quarantines the app on first launch
("cannot be opened because the developer cannot be verified") and the only
way past it is a manual right-click-Open or a `spctl` override — tribal
knowledge, not a real distribution story.

Fixing this needs three cooperating pieces:
1. **Developer-ID code signing** with the **hardened runtime** and the right
   **entitlements** (the app dlopen's unsigned third-party libretro core
   `.dylib`s and runs a loopback HTTP server + WASM, both of which the
   hardened runtime blocks by default — see [native-emulation-design.md](native-emulation-design.md)
   and [in-page-play-design.md](in-page-play-design.md)).
2. **Apple notarization** (`notarytool`) — Apple's automated malware scan that
   must pass before Gatekeeper trusts the binary on a machine that isn't the
   builder's.
3. **Stapling** — attaching the notarization ticket to the DMG so Gatekeeper
   can verify it **offline** (no network round-trip to Apple at first launch).

## Scope

**Covers:**
- `src-tauri/tauri.conf.json` `bundle.macOS` signing configuration.
- A new hardened-runtime entitlements plist.
- A release wrapper script that signs, notarizes, staples, and verifies the
  DMG, wired into the `recipe.py package` target.
- Credential/secrets handling story (env vars / keychain profile) for
  `notarytool`.
- An automated Gatekeeper-acceptance check (`spctl -a -t open --context
  context:primary-signature`) added to release verification.
- Documenting exactly what is real, tested plumbing vs. what could not be
  exercised in this environment.

**Explicitly does not cover** (out of scope, see release plan §4):
- Actually enrolling in the Apple Developer Program or provisioning a real
  Developer-ID Application certificate — a human/maintainer action with a
  cost and identity-verification step Apple gates on a real legal entity.
- Running a real notarization submission against Apple's service, or
  Gatekeeper-verifying the stapled DMG on a clean secondary Mac — both
  require the credentials/hardware above and are deferred as a documented
  human follow-up (same pattern as v0.29 #35/#36).
- Windows/Linux code-signing (Authenticode, etc.) — this project only
  bundles a macOS DMG target today (`bundle.targets: "dmg"`).
- Auto-update / Sparkle-style update channel signing — no auto-updater
  exists in this project yet.

## Design

### 1. Signing identity sourcing

Developer-ID signing needs a **"Developer ID Application: <Name> (<TEAMID>)"**
identity in the build machine's keychain. This project has no CI secrets
store today, so the identity is sourced entirely from environment variables
read by the new wrapper script — nothing is hardcoded, and everything
degrades to a clear no-op when absent:

| Env var | Purpose |
|---|---|
| `RGP_SIGNING_IDENTITY` | Exact keychain identity string / SHA-1 hash to pass to `codesign --sign`. If unset, signing is skipped entirely. |
| `RGP_APPLE_TEAM_ID` | Apple Developer Team ID, used for `notarytool` submission and to sanity-check the signing identity matches. |

Tauri's bundler (`tauri-bundler`) natively supports Developer-ID signing via
the `bundle.macOS.signingIdentity` config key, reading the same environment
convention Tauri v2 already documents
(`APPLE_SIGNING_IDENTITY` / `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`
for importing a `.p12` into a CI keychain). We deliberately keep our own
`RGP_*` variables as the source of truth in the wrapper script (so the
no-op-when-absent contract is explicit and testable) and forward them into
the Tauri-native env vars when present, rather than requiring every consumer
to know Tauri's internal variable names.

Local development (no CI): a developer with a real Developer-ID certificate
already installed in their login keychain sets `RGP_SIGNING_IDENTITY` to
their identity string (`security find-identity -v -p codesigning` lists
candidates) and `RGP_APPLE_TEAM_ID`, then runs `recipe.py package` — the
existing keychain is used directly, no `.p12` import needed.

CI (future): a `.p12` export + `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD`
would be imported into a temporary keychain before the build step. Not
implemented in this release (no CI runner exists yet for this project) but
documented here as the extension point.

### 2. Hardened runtime + entitlements

New file: `src-tauri/entitlements.plist`. Hardened runtime is required for
notarization; it defaults to a locked-down process, so we must explicitly
opt back in to the specific things this app already legitimately does:

| Entitlement | Why this app needs it |
|---|---|
| `com.apple.security.cs.allow-jit` | The in-page player path runs EmulatorJS (WASM) in the webview — WASM JIT/execution needs this under hardened runtime. See [in-page-play-design.md](in-page-play-design.md). |
| `com.apple.security.cs.allow-unsigned-executable-memory` | Same WASM/webview path; some WebKit WASM configurations need executable memory that isn't itself code-signed. |
| `com.apple.security.cs.disable-library-validation` | The native emulation path `dlopen`s third-party libretro core `.dylib`s (`fceumm`, etc.) via hand-rolled `libloading` FFI. Those cores are **not** signed by our Team ID, so default library validation would refuse to load them. See [native-emulation-design.md](native-emulation-design.md). |
| `com.apple.security.network.client` | Outbound HTTP for metadata/cover-art enrichment and ROM-provider browsing ([library-import-design.md](library-import-design.md), [console-browse-design.md](console-browse-design.md)). |
| `com.apple.security.network.server` | The loopback `http://127.0.0.1` play server (`tiny_http`) the in-page player embeds as an iframe origin. See [in-page-play-design.md](in-page-play-design.md). |

`com.apple.security.cs.disable-library-validation` is the widest-reaching
entitlement here — it's required specifically because this app's whole
native-emulation value proposition is dynamically loading unsigned
community-built cores, which is fundamentally in tension with the hardened
runtime's default trust model. This is a deliberate, documented trade-off,
not an oversight: without it, W21 native emulation cannot ship signed at
all. Sandbox (`com.apple.security.app-sandbox`) is **not** enabled — the app
already reads/writes an arbitrary user-chosen Games directory and loads
arbitrary user-supplied core/ROM files, which does not fit the sandbox's
container model without a much larger redesign (security-scoped bookmarks
etc.); that redesign is out of scope for this release.

### 3. Wiring into `tauri.conf.json`

```jsonc
"bundle": {
  "active": true,
  "targets": "dmg",
  "icon": [ /* unchanged */ ],
  "macOS": {
    "entitlements": "entitlements.plist",
    "hardenedRuntime": true,
    "signingIdentity": null
  }
}
```

`signingIdentity: null` is Tauri's documented "ad-hoc / unsigned" default —
it keeps `pnpm tauri build` working exactly as before (unsigned dev builds)
when invoked directly. The **release** path overrides this at build time via
the `APPLE_SIGNING_IDENTITY` environment variable (Tauri reads env over the
static config value when both are present), which is how the wrapper script
below injects the identity only when one is actually configured — no
conditional edits to the checked-in config are needed.

### 4. Release wrapper script

New file: `scripts/release_sign_notarize.py` (stdlib-only Python, matching
the existing `scripts/` scripting convention used by
[sync_deps.py](../../.claude/skills/grm-sync-deps/sync_deps.py)). Invoked by
the new `recipe.py package` target. Steps, each individually conditional and
loud about why it's skipped:

1. **Build.** Runs `pnpm tauri build` (optionally with `APPLE_SIGNING_IDENTITY`
   / hardened runtime forwarded per §1 when `RGP_SIGNING_IDENTITY` is set).
2. **Sign-verify.** If a signing identity was used, runs
   `codesign --verify --deep --strict --verbose=2` against the built `.app`
   and fails loud on mismatch. Skipped (logged, exit 0) when unsigned.
3. **Notarize.** If `RGP_SIGNING_IDENTITY` **and** the notarytool credential
   profile (§5) are both present: `xcrun notarytool submit <dmg> --keychain-profile
   <profile> --wait`, capturing the submission log on failure. Skipped
   (logged) otherwise — the existing unsigned DMG build keeps working
   end-to-end either way.
4. **Staple.** On successful notarization: `xcrun stapler staple <dmg>`.
5. **Gatekeeper verification.** Always attempted against whatever DMG was
   produced: `spctl -a -t open --context context:primary-signature -v <dmg>`
   (§7) — reports pass/fail either way; a failure here is expected and
   non-fatal for an unsigned/un-notarized dev build, but is the acceptance
   gate for a real Developer-ID release.

The script never fails the overall build because signing/notarization
credentials are absent — that would break the existing unsigned-DMG path
that CI-less local development and this sandboxed environment both rely on.
It fails loud only on a **real** error in a step it did attempt (e.g. a
signing identity was supplied but signing itself failed).

### 5. Notarization credentials

`notarytool` needs one of: an App Store Connect API key, or an
app-specific-password + Apple ID + team ID, stored as a **keychain profile**
(`xcrun notarytool store-credentials`) so the actual secret never touches
disk in the repo or in shell history beyond the one-time interactive setup.

Documented one-time setup (see also the README-level checklist added below):

```bash
xcrun notarytool store-credentials "retro-game-player-notary" \
  --apple-id "<apple-id-email>" \
  --team-id "<TEAMID>" \
  --password "<app-specific-password>"
```

This writes an encrypted profile into the local login keychain under the
profile name; nothing secret is ever written to a file the wrapper script
reads. The wrapper script only needs to know the **profile name**:

| Env var | Purpose |
|---|---|
| `RGP_NOTARY_PROFILE` | Keychain profile name created above. If unset, notarization is skipped (logged), independent of whether signing ran. |

This keeps the credential-handling story entirely local-keychain-based for
now, consistent with there being no CI secrets manager in this project yet.
A future CI setup would instead inject the API-key form
(`--key`/`--key-id`/`--issuer`) via CI secrets and is noted as a follow-up.

### 6. DMG assembly (W335, fixes issue #45)

**Problem.** Every `pnpm tauri build` DMG step since v0.26 failed with
`hdiutil: create failed - No space left on device`, regardless of actual free
disk. Root cause: Tauri's generated `bundle_dmg.sh` derives its `rw.$$` temp
read-write image path **inside `bundle/macos/`** — the exact directory it
then passes to `hdiutil create -srcfolder`. As the temp image grows during
the copy phase, `hdiutil` tries to copy the temp image into itself
(`bundle/macos/` swallowing its own growing child), which manifests as a
bogus "no space" error no matter how much disk is actually free. One stale
`rw.*.dmg` per failed release attempt (v0.26.0 through v0.29.0, roughly
420MB total) had also accumulated in `bundle/macos/` by the time this was
diagnosed during the v0.32 release, inflating every subsequent attempt
further, alongside a stale pre-rename `Harmony.app` left over from the
project's old name.

**Fix.** `scripts/release_sign_notarize.py` no longer lets Tauri build the
DMG at all:

1. **Build stops at the `.app`.** The build step invokes
   `pnpm tauri build --bundles app` (Tauri CLI's `-b/--bundles` flag) instead
   of the bare `pnpm tauri build`. This produces the `.app` bundle in
   `bundle/macos/` exactly as before, but never invokes Tauri's generated
   `bundle_dmg.sh` — so the self-swallow bug is structurally never triggered.
   No edit to the committed `tauri.conf.json` `bundle.targets` was needed;
   `--bundles` is a build-time CLI override, so a plain `pnpm tauri build`
   invoked directly by a developer is unaffected and keeps its historical
   (broken) DMG-via-`bundle_dmg.sh` behavior — the fix lives entirely in the
   wrapper script's invocation, which is the one path `recipe.py package` /
   `pnpm release` actually uses.
2. **`BundleMacosGuard`** runs immediately after the build, before DMG
   assembly: it deletes any stale `rw.*.dmg` temp-image leftovers from a
   previous failed `bundle_dmg.sh` run (logging each removal), then asserts
   `bundle/macos/` contains **exactly one** `.app` and nothing else. Any
   other unexpected entry (a stale differently-named `.app`, leftover junk)
   is a hard failure rather than a "pick one" heuristic — an ambiguous
   `bundle/macos/` is exactly the situation that inflated every DMG since
   v0.26 and deserves a loud stop, not a silent guess.
3. **`DmgStagingBuilder`** assembles the DMG itself via the proven
   clean-staging approach used as a manual workaround for the v0.32 release:
   copy the verified `.app` into a **fresh temporary staging directory**
   (`tempfile.TemporaryDirectory`, never `bundle/macos/` itself), add an
   `/Applications` symlink for drag-to-install, then run
   `hdiutil create -volname "Retro Game Player" -srcfolder <staging> -ov
   -format UDZO <out.dmg>`. Because `-srcfolder` now points at a directory
   that contains only the `.app` + the symlink — and `hdiutil`'s own output
   file lives in a completely different directory
   (`bundle/dmg/Retro Game Player.dmg`) — there is no directory that is both
   the copy source and the temp-image destination, so the self-swallow bug
   is structurally impossible with this layout.

Every signing/notarization/staple/Gatekeeper-verify step downstream (§1–§6
above) is untouched: `CodesignVerifyStep`, `NotarizeStep`, `StapleStep`, and
`GatekeeperVerifyStep` all still receive the same `app_path`/`dmg_path`
shapes as before, now sourced from the guard and the staging builder instead
of a glob over Tauri's own (previously broken) DMG output directory.

**Testing.** `BundleMacosGuard` and `DmgStagingBuilder` are covered by
`scripts/release_sign_notarize.py --self-test` against real `tempfile`
directories — never the real `src-tauri/target` build output — and never
invoke a real `hdiutil` (the script's `CommandRunner` subprocess seam stays
`dry_run=True` throughout the self-test, so command *construction* is
asserted, not execution). `--self-test` is wired into `pnpm test` via
`scripts/release_sign_notarize.test.mjs`, which shells out to
`python3 scripts/release_sign_notarize.py --self-test` and asserts exit code
0 plus the self-test's own pass/fail report — no real DMG build runs in CI or
in this branch; that stays a human/integration-master release-time step (see
§7 below, unchanged).

### 7. Automated Gatekeeper check

`spctl -a -t open --context context:primary-signature -v <path-to-dmg>` is
the same check Gatekeeper itself performs against a downloaded DMG. Wired
into the release wrapper script (step 5 above) and exits non-zero when the
DMG would be blocked, so the release step surfaces the failure the same way
a fresh-Mac user would hit it — without needing an actual second Mac to
observe it. This is what the acceptance criterion's "automated `spctl`
check added to the release verification step" means in this codebase: it's
part of `recipe.py package`, not a separate manual step.

### 8. What's real plumbing vs. what's unverifiable here

| Claim | Status in this environment |
|---|---|
| `tauri.conf.json` bundle config accepts `macOS.entitlements` / `hardenedRuntime` / `signingIdentity` | Verified — Tauri v2 bundler schema; `cargo check`, `cargo build --release`, and the app-bundling step all succeed with these keys present and `signingIdentity: null` (ad-hoc). |
| Entitlements plist is well-formed and merged into the signed binary | Verified structurally (valid plist, `plutil -lint` clean); **cannot** verify the merged binary's actual entitlements without a real signing identity to sign with. |
| Wrapper script's conditional skip logic (no identity/profile → clean unsigned build) | Verified via `--self-test` (stdlib-only, no network) — see `scripts/release_sign_notarize.py`. |
| Wrapper script's sign / notarize / staple code paths | **Not exercised end-to-end** — no real Developer-ID identity or Apple ID credentials exist in this environment. Code paths are written against the documented `codesign`/`notarytool`/`stapler` CLI contracts and unit-tested for command construction (`--self-test`), but never run against Apple's live notarization service. |
| `BundleMacosGuard` / `DmgStagingBuilder` (W335 DMG assembly, §6) — stale-artifact cleanup, single-`.app` assertion, staging-dir construction, `hdiutil` argv | Verified via `--self-test` against real `tempfile` directories; the `hdiutil` invocation itself is asserted for shape (never a directory that could self-swallow) but not executed for real — the subprocess seam stays `dry_run=True`. Per this work item's done-criteria, **no real DMG build was run in this branch**; a real end-to-end `recipe.py package` run is the integration master's release-time responsibility. |
| `pnpm tauri build --bundles app` / `recipe.py package` produces a `.dmg` file at all, in this sandbox | **Not run in this branch** (see row above; explicitly out of scope for this work item). Historically (pre-W335), the old `bundle_dmg.sh` path additionally failed here with `execution error: Not authorized to send Apple events to Finder. (-1743)` (this sandbox denies AppleScript/Apple-events automation) **on top of** the "No space left on device" self-swallow bug (#45) — both are moot now that DMG assembly no longer goes through `bundle_dmg.sh` at all (§6), but neither has been re-verified against a real `hdiutil` run in this sandbox. |
| `spctl -a -t open --context context:primary-signature` invocation itself (command construction + wiring into the release script) | Verified via `--self-test` — asserts the exact `spctl` argv is built and would run against whatever DMG path is found. **Not run against a real produced DMG file** in this environment, because no real DMG build was run in this branch (see rows above). |
| `spctl` verification on a real notarized+stapled DMG, on a clean secondary Mac with no prior Gatekeeper overrides | **Not verifiable here** — needs a real Developer-ID cert, a real notarization submission, a machine that can actually produce a DMG, and a genuinely clean machine (this dev machine's Gatekeeper state is not clean/naive either). Tracked as a follow-up. |

## Acceptance

- [x] This design doc covers signing-identity sourcing, entitlements,
  hardened runtime, the `notarytool` submission/staple flow, and
  credential/secrets handling.
- [x] `src-tauri/tauri.conf.json` `bundle.macOS` declares `entitlements`,
  `hardenedRuntime: true`, and a `signingIdentity` extension point, without
  breaking the existing unsigned `pnpm tauri build` path.
- [x] `src-tauri/entitlements.plist` exists, is valid, and documents why each
  entitlement is present.
- [x] `scripts/release_sign_notarize.py` implements build → sign-verify →
  notarize → staple → spctl-verify, each step individually conditional and
  loud when skipped, wired into `recipe.py package`.
- [x] The credential-setup story (`notarytool store-credentials`, the two
  `RGP_*`/one profile-name env vars) is documented above and in the
  release-doc checklist.
- [x] `spctl -a -t open --context context:primary-signature` is part of the
  automated release verification step, not a manual afterthought.
- [x] The gap table in §8 is explicit about what shipped as tested plumbing
  vs. what needs real Apple Developer-ID credentials / a clean Mac to
  verify, matching the v0.29 #35/#36 honest-gap pattern.
- [x] **W335 (closes #45):** `scripts/release_sign_notarize.py` assembles the
  DMG via the clean-staging `hdiutil` path (§6) instead of relying on
  Tauri's `bundle_dmg.sh`; `BundleMacosGuard` cleans stale `rw.*.dmg`
  artifacts and asserts a single `.app` before staging; every
  signing/notarization conditional step is untouched; the staging builder
  and guard are unit-tested with the subprocess seam mocked (no real
  `hdiutil` in CI).

## Open questions

- Should the wrapper script eventually support the App Store Connect API-key
  form of `notarytool` credentials (for a future CI runner), in addition to
  the keychain-profile form? Deferred — no CI exists for this project yet;
  revisit when one is introduced.
- Should Developer-ID Installer signing (for a `.pkg`, distinct from
  Developer-ID Application for the `.app`/DMG) be added if a `.pkg` target
  is ever introduced alongside the current `dmg`-only target? Not needed
  today — out of scope.

## Follow-ups

- **Integration-master step, release-time:** run one real `recipe.py package`
  (or `python3 scripts/release_sign_notarize.py`) end-to-end to confirm the
  clean-staging DMG assembly (§6) actually produces a `.dmg` via real
  `hdiutil` — this work item intentionally does not run a real DMG build in
  its branch.
- **Human step, post-merge:** enroll in the Apple Developer Program,
  provision a real Developer-ID Application certificate, run
  `xcrun notarytool store-credentials` with real credentials, and execute
  one real `recipe.py package` end-to-end to confirm the sign→notarize→
  staple chain against Apple's live service.
- **Human step, post-merge:** verify the resulting stapled DMG installs and
  launches cleanly on a genuinely clean secondary Mac (no prior overrides,
  fresh user account), confirming Gatekeeper accepts it with zero manual
  override — the acceptance bar this whole feature exists to satisfy.
- **Superseded by W335 (§6):** DMG assembly no longer goes through Tauri's
  `bundle_dmg.sh` (which needed Finder/AppleScript automation permission and
  had the `#45` self-swallow bug), so the old Apple-events-permission
  blocker no longer applies going forward. Superseded by the
  "run one real `recipe.py package`" follow-up above, which now covers
  confirming a `.dmg` is actually produced via the plain `hdiutil` path.
- Consider CI-runner secrets wiring (`.p12` import, API-key `notarytool`
  form) once this project gains a CI pipeline.
- Consider Developer-ID Installer / `.pkg` signing if a `.pkg` bundle target
  is ever added.

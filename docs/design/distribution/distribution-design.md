# Distribution

> **Up:** [↑ Distribution](README.md)
>
> Partially fleshed out as of v0.30 "Passport" (W300) — the macOS
> sign/notarize/staple story now has a concrete home; other artifact
> kinds/channels remain to be filled in as they're built.

## Motivation
Describe how the project gets from a tagged commit to something a consumer can
install, so packaging and release decisions are explicit and repeatable.

## Scope
Build artifacts, release channels, versioning, and the delivery transport. Not
the in-repo release *process* mechanics (those are framework-internal) — this is
the project's own distribution model.

## Design
_(to be filled in)_ Artifact kinds and how they are built; channels (stable /
pre-release); version scheme; how consumers fetch and verify a release.

**macOS DMG (v0.30 "Passport"):** the only artifact kind shipped today is a
`.dmg` produced by `pnpm tauri build` / `recipe.py package`
(`.claude/recipes.json`). See
[notarization-distribution-design.md](../notarization-distribution-design.md)
for the full Developer-ID signing + hardened runtime + notarization + staple
+ Gatekeeper-verification story; this doc only anchors it as one part of the
overall distribution model.

### Release checklist — macOS DMG

1. Run `recipe.py package` (or `pnpm release` / `python3
   scripts/release_sign_notarize.py` directly).
2. Unsigned (no `RGP_SIGNING_IDENTITY`): produces the same ad-hoc DMG as
   `pnpm tauri build` always has — expected for local/dev builds.
3. Signed release: set `RGP_SIGNING_IDENTITY` (+ `RGP_APPLE_TEAM_ID`) to a
   real Developer-ID Application identity already in the build machine's
   keychain.
4. Notarized release: additionally set `RGP_NOTARY_PROFILE` to a profile
   created once via `xcrun notarytool store-credentials` (see
   [notarization-distribution-design.md](../notarization-distribution-design.md)
   §5) — the script then submits, waits, and staples automatically.
5. The script always runs `spctl -a -t open --context
   context:primary-signature` against the produced DMG and reports
   ACCEPTED/REJECTED; a signed release must show ACCEPTED before shipping.
6. **Not verifiable in this development environment:** a real notarization
   submission against Apple's live service, and Gatekeeper acceptance on a
   genuinely clean secondary Mac — both require real Apple Developer-ID
   credentials and hardware this sandbox doesn't have. See
   [notarization-distribution-design.md](../notarization-distribution-design.md)
   §7 for the full honest-gap accounting.

## Acceptance
- The distribution model is documented well enough to cut a release and have
  a consumer install it without tribal knowledge — for the macOS DMG this is
  satisfied by the checklist above plus
  [notarization-distribution-design.md](../notarization-distribution-design.md).
- _(to be filled in)_ Other artifact kinds/channels, once they exist.

## Open questions
- _(to be filled in)_

## Follow-ups
- Real notarization run + clean-Mac Gatekeeper verification (human step;
  tracked in [notarization-distribution-design.md](../notarization-distribution-design.md)
  Follow-ups).

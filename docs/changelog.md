# Changelog

> **Up:** [↑ Docs](README.md)


> The **front-facing** record of shipped releases of **this project**, newest
> first — one section per tagged version, 3–8 bullets aimed at your users.
> Written in the project's own voice: what changed, why it matters to someone
> using the product. **No process leakage** — never a ticket/issue ID, an
> internal task name, or a restated prompt/instruction. The complete internal
> engineering record (which may reference tickets and technical detail) lives
> in `version-history.md`; write both when you cut a release. `grm-project-release`
> extracts release notes from this file, not `version-history.md`.

<!-- Add a new "## vX.Y — <title>" section per release, newest first. -->

## v0.44 — Paper Trail (2026-07-12)

A small housekeeping release cleaning up release downloads — nothing to see
in the app.

- The DMG installer's filename now includes its version number.
- Corrected a few past release pages so their notes accurately reflect
  what was (and wasn't) shipped for that version.

## v0.43 — Provenance (2026-07-11)

A small maintenance release focused on how the app itself gets built and
shipped — nothing to see in the app.

- Hardened the release process so a build can no longer be silently
  distributed without proper Developer-ID signing and notarization.

# Docs

> **Docs root.** Each tier below has an index; start here and follow links down.

## Overview

Retro Game Player's documentation tree. Each tier below has an index; start
here and follow links down.

## Tiers

- [design/](design/README.md) — Design docs: architecture, feature designs, decision records
- [grimoire/](grimoire/README.md) — Agent-only operational docs: organization, playbooks
- [coding-standards/](coding-standards/README.md) — Per-language coding standards

## Developer workflow

**Release-planning docs are intentionally split across two locations.**
`docs/release-planning/release-planning-v0.23.md` onward live under
`docs/release-planning/`; `docs/release-planning-v0.1.md` through
`docs/release-planning-v0.22.md` remain as flat top-level files. This is a
deliberate, documented decision, not an oversight: those older filenames are
path-locked and enforced by `release-plan-guard.sh` per the exception recorded
in `docs/grimoire/docs-organization-design.md`, so they are not moved. All
inbound links (this file, `roadmap.md`, `version-history.md`) already point at
the correct location for each plan's era.

## Reference docs

- [quickstart.md](quickstart.md) — Getting started with Grimoire
- [project-structure.md](project-structure.md) — Standard project directory layout
- [architecture-guidelines.md](architecture-guidelines.md) — Architectural principles & module boundaries
- [features.md](features.md) — Feature reference: all shipped capabilities and their docs
- [roadmap.md](roadmap.md) — Release roadmap and backlog
- [version-history.md](version-history.md) — Shipped release history

<!-- docs-map:begin -->
### Top level

- [`architecture-guidelines.md`](architecture-guidelines.md)
- [`coding-standards.md`](coding-standards.md)
- [`features.md`](features.md)
- [`project-structure.md`](project-structure.md)
- [`quickstart.md`](quickstart.md)
- [`roadmap.md`](roadmap.md)

### `coding-standards/`

- [`coding-standards/css.md`](coding-standards/css.md)
- [`coding-standards/html.md`](coding-standards/html.md)
- [`coding-standards/javascript.md`](coding-standards/javascript.md)
- [`coding-standards/python.md`](coding-standards/python.md)
- [`coding-standards/rust.md`](coding-standards/rust.md)
- [`coding-standards/tooling.md`](coding-standards/tooling.md)

### `design/`

- [`design/architecture/architecture-design.md`](design/architecture/architecture-design.md)
- [`design/data-persistence/data-persistence-design.md`](design/data-persistence/data-persistence-design.md)
- [`design/distribution/distribution-design.md`](design/distribution/distribution-design.md)
- [`design/ux/components.md`](design/ux/components.md)
- [`design/ux/design-language.md`](design/ux/design-language.md)
- [`design/ux/theme.md`](design/ux/theme.md)

### `template-files/`

- [`template-files/design-doc-template.md`](template-files/design-doc-template.md)
<!-- docs-map:end -->

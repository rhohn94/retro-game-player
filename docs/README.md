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
- [`execution-profile-spike-s1.md`](execution-profile-spike-s1.md)
- [`features.md`](features.md)
- [`project-structure.md`](project-structure.md)
- [`quickstart.md`](quickstart.md)
- [`release-planning-v0.1.md`](release-planning-v0.1.md)
- [`release-planning-v0.10.md`](release-planning-v0.10.md)
- [`release-planning-v0.11.md`](release-planning-v0.11.md)
- [`release-planning-v0.12.md`](release-planning-v0.12.md)
- [`release-planning-v0.13.md`](release-planning-v0.13.md)
- [`release-planning-v0.14.md`](release-planning-v0.14.md)
- [`release-planning-v0.15.md`](release-planning-v0.15.md)
- [`release-planning-v0.16.md`](release-planning-v0.16.md)
- [`release-planning-v0.17.md`](release-planning-v0.17.md)
- [`release-planning-v0.18.md`](release-planning-v0.18.md)
- [`release-planning-v0.19.md`](release-planning-v0.19.md)
- [`release-planning-v0.2.md`](release-planning-v0.2.md)
- [`release-planning-v0.20.md`](release-planning-v0.20.md)
- [`release-planning-v0.21.md`](release-planning-v0.21.md)
- [`release-planning-v0.22.md`](release-planning-v0.22.md)
- [`release-planning-v0.3.md`](release-planning-v0.3.md)
- [`release-planning-v0.4.md`](release-planning-v0.4.md)
- [`release-planning-v0.5.md`](release-planning-v0.5.md)
- [`release-planning-v0.6.md`](release-planning-v0.6.md)
- [`release-planning-v0.7.md`](release-planning-v0.7.md)
- [`release-planning-v0.8.md`](release-planning-v0.8.md)
- [`release-planning-v0.9.md`](release-planning-v0.9.md)
- [`roadmap.md`](roadmap.md)
- [`tickets-v0.1-remaining.md`](tickets-v0.1-remaining.md)
- [`version-history.md`](version-history.md)

### `coding-standards/`

- [`coding-standards/css.md`](coding-standards/css.md)
- [`coding-standards/html.md`](coding-standards/html.md)
- [`coding-standards/javascript.md`](coding-standards/javascript.md)
- [`coding-standards/python.md`](coding-standards/python.md)
- [`coding-standards/rust.md`](coding-standards/rust.md)
- [`coding-standards/tooling.md`](coding-standards/tooling.md)

### `design/`

- [`design/app-infrastructure-design.md`](design/app-infrastructure-design.md)
- [`design/architecture-design.md`](design/architecture-design.md)
- [`design/architecture/architecture-design.md`](design/architecture/architecture-design.md)
- [`design/boot-latency-spike.md`](design/boot-latency-spike.md)
- [`design/collections-design.md`](design/collections-design.md)
- [`design/console-browse-design.md`](design/console-browse-design.md)
- [`design/console-catalog-design.md`](design/console-catalog-design.md)
- [`design/controller-input-design.md`](design/controller-input-design.md)
- [`design/copilot-grm-namespacing-design.md`](design/copilot-grm-namespacing-design.md)
- [`design/core-discovery-design.md`](design/core-discovery-design.md)
- [`design/core-management-design.md`](design/core-management-design.md)
- [`design/core-options-design.md`](design/core-options-design.md)
- [`design/crossover-integration-design.md`](design/crossover-integration-design.md)
- [`design/crt-filter-design.md`](design/crt-filter-design.md)
- [`design/data-persistence/data-persistence-design.md`](design/data-persistence/data-persistence-design.md)
- [`design/dependency-channel-conformance.md`](design/dependency-channel-conformance.md)
- [`design/direct-download-design.md`](design/direct-download-design.md)
- [`design/distribution/distribution-design.md`](design/distribution/distribution-design.md)
- [`design/download-browsing-ux-design.md`](design/download-browsing-ux-design.md)
- [`design/download-search-design.md`](design/download-search-design.md)
- [`design/emulation-launch-design.md`](design/emulation-launch-design.md)
- [`design/error-telemetry-design.md`](design/error-telemetry-design.md)
- [`design/familiar-enrichment-design.md`](design/familiar-enrichment-design.md)
- [`design/file-search-design.md`](design/file-search-design.md)
- [`design/fleet-ensign-design.md`](design/fleet-ensign-design.md)
- [`design/games-directory-design.md`](design/games-directory-design.md)
- [`design/harmony-ux-design.md`](design/harmony-ux-design.md)
- [`design/in-page-play-design.md`](design/in-page-play-design.md)
- [`design/interaction-wiring-design.md`](design/interaction-wiring-design.md)
- [`design/issue-label-taxonomy.md`](design/issue-label-taxonomy.md)
- [`design/justfile-standard-design.md`](design/justfile-standard-design.md)
- [`design/library-filtering-design.md`](design/library-filtering-design.md)
- [`design/library-identification-design.md`](design/library-identification-design.md)
- [`design/library-import-design.md`](design/library-import-design.md)
- [`design/library-life-design.md`](design/library-life-design.md)
- [`design/metadata-art-design.md`](design/metadata-art-design.md)
- [`design/native-emulation-design.md`](design/native-emulation-design.md)
- [`design/native-vibrancy-design.md`](design/native-vibrancy-design.md)
- [`design/non-retro-library-design.md`](design/non-retro-library-design.md)
- [`design/notarization-distribution-design.md`](design/notarization-distribution-design.md)
- [`design/performance-tooling-design.md`](design/performance-tooling-design.md)
- [`design/persistence-design.md`](design/persistence-design.md)
- [`design/presentation-shell-design.md`](design/presentation-shell-design.md)
- [`design/provider-discovery-design.md`](design/provider-discovery-design.md)
- [`design/retroachievements-design.md`](design/retroachievements-design.md)
- [`design/runtime-verification-design.md`](design/runtime-verification-design.md)
- [`design/save-persistence-design.md`](design/save-persistence-design.md)
- [`design/settings-shell-design.md`](design/settings-shell-design.md)
- [`design/tv-mode-design.md`](design/tv-mode-design.md)
- [`design/ux/components.md`](design/ux/components.md)
- [`design/ux/design-language.md`](design/ux/design-language.md)
- [`design/ux/theme.md`](design/ux/theme.md)
- [`design/vibrancy-blur-impl.md`](design/vibrancy-blur-impl.md)
- [`design/workflow-candidates.md`](design/workflow-candidates.md)

### `grimoire/`

- [`grimoire/design/agent-roles-design.md`](grimoire/design/agent-roles-design.md)
- [`grimoire/design/architecture-fitness-design.md`](grimoire/design/architecture-fitness-design.md)
- [`grimoire/design/autonomous-push-prompt-suppression-design.md`](grimoire/design/autonomous-push-prompt-suppression-design.md)
- [`grimoire/design/autonomy-hardening-design.md`](grimoire/design/autonomy-hardening-design.md)
- [`grimoire/design/autonomy-scheduling-design.md`](grimoire/design/autonomy-scheduling-design.md)
- [`grimoire/design/clean-room-design.md`](grimoire/design/clean-room-design.md)
- [`grimoire/design/cost-governance-design.md`](grimoire/design/cost-governance-design.md)
- [`grimoire/design/doc-assurance-design.md`](grimoire/design/doc-assurance-design.md)
- [`grimoire/design/documentation-separation-design.md`](grimoire/design/documentation-separation-design.md)
- [`grimoire/design/dry-duplication-enforcement-design.md`](grimoire/design/dry-duplication-enforcement-design.md)
- [`grimoire/design/execution-profiles-design.md`](grimoire/design/execution-profiles-design.md)
- [`grimoire/design/feature-aware-sync-design.md`](grimoire/design/feature-aware-sync-design.md)
- [`grimoire/design/grm-namespacing-design.md`](grimoire/design/grm-namespacing-design.md)
- [`grimoire/design/hard-reset-design.md`](grimoire/design/hard-reset-design.md)
- [`grimoire/design/html-css-quality-enforcement-design.md`](grimoire/design/html-css-quality-enforcement-design.md)
- [`grimoire/design/issue-label-taxonomy.md`](grimoire/design/issue-label-taxonomy.md)
- [`grimoire/design/issue-tracker-design.md`](grimoire/design/issue-tracker-design.md)
- [`grimoire/design/managed-project-tooling-design.md`](grimoire/design/managed-project-tooling-design.md)
- [`grimoire/design/merge-gate-quality-design.md`](grimoire/design/merge-gate-quality-design.md)
- [`grimoire/design/model-effort-profiles-design.md`](grimoire/design/model-effort-profiles-design.md)
- [`grimoire/design/modularization-metrics-design.md`](grimoire/design/modularization-metrics-design.md)
- [`grimoire/design/onboarding-design.md`](grimoire/design/onboarding-design.md)
- [`grimoire/design/release-planning-workflow-design.md`](grimoire/design/release-planning-workflow-design.md)
- [`grimoire/design/rust-quality-enforcement-design.md`](grimoire/design/rust-quality-enforcement-design.md)
- [`grimoire/design/token-efficiency-design.md`](grimoire/design/token-efficiency-design.md)
- [`grimoire/design/token-efficiency-enforcement-design.md`](grimoire/design/token-efficiency-enforcement-design.md)
- [`grimoire/design/ux-design-language-design.md`](grimoire/design/ux-design-language-design.md)
- [`grimoire/design/ux-enhancements-design.md`](grimoire/design/ux-enhancements-design.md)
- [`grimoire/design/work-paradigm-design.md`](grimoire/design/work-paradigm-design.md)
- [`grimoire/design/workflow-candidates.md`](grimoire/design/workflow-candidates.md)
- [`grimoire/design/write-capable-workflow-design.md`](grimoire/design/write-capable-workflow-design.md)
- [`grimoire/docs-organization-design.md`](grimoire/docs-organization-design.md)
- [`grimoire/execution-profile-spike-s1.md`](grimoire/execution-profile-spike-s1.md)
- [`grimoire/feature-playbook-validation.md`](grimoire/feature-playbook-validation.md)
- [`grimoire/integration-workflow.md`](grimoire/integration-workflow.md)
- [`grimoire/issue-tracker-cost-spike.md`](grimoire/issue-tracker-cost-spike.md)
- [`grimoire/issue-tracker-cost-validation.md`](grimoire/issue-tracker-cost-validation.md)
- [`grimoire/qa-ledger.md`](grimoire/qa-ledger.md)
- [`grimoire/sync-flow-audit.md`](grimoire/sync-flow-audit.md)
- [`grimoire/version-design.md`](grimoire/version-design.md)

### `release-planning/`

- [`release-planning/release-planning-v0.23.1.md`](release-planning/release-planning-v0.23.1.md)
- [`release-planning/release-planning-v0.23.md`](release-planning/release-planning-v0.23.md)
- [`release-planning/release-planning-v0.24.md`](release-planning/release-planning-v0.24.md)
- [`release-planning/release-planning-v0.25.md`](release-planning/release-planning-v0.25.md)
- [`release-planning/release-planning-v0.26.1.md`](release-planning/release-planning-v0.26.1.md)
- [`release-planning/release-planning-v0.26.2.md`](release-planning/release-planning-v0.26.2.md)
- [`release-planning/release-planning-v0.26.md`](release-planning/release-planning-v0.26.md)
- [`release-planning/release-planning-v0.27.1.md`](release-planning/release-planning-v0.27.1.md)
- [`release-planning/release-planning-v0.27.md`](release-planning/release-planning-v0.27.md)
- [`release-planning/release-planning-v0.28.md`](release-planning/release-planning-v0.28.md)
- [`release-planning/release-planning-v0.29.1.md`](release-planning/release-planning-v0.29.1.md)
- [`release-planning/release-planning-v0.29.md`](release-planning/release-planning-v0.29.md)
- [`release-planning/release-planning-v0.30.md`](release-planning/release-planning-v0.30.md)
- [`release-planning/release-planning-v0.31.md`](release-planning/release-planning-v0.31.md)
- [`release-planning/release-planning-v0.32.md`](release-planning/release-planning-v0.32.md)
- [`release-planning/release-planning-v0.33.md`](release-planning/release-planning-v0.33.md)
- [`release-planning/release-planning-v0.34.md`](release-planning/release-planning-v0.34.md)
- [`release-planning/release-planning-v0.35.md`](release-planning/release-planning-v0.35.md)
- [`release-planning/release-planning-v0.36.md`](release-planning/release-planning-v0.36.md)
- [`release-planning/release-planning-v0.37.md`](release-planning/release-planning-v0.37.md)
- [`release-planning/release-planning-v0.38.md`](release-planning/release-planning-v0.38.md)
- [`release-planning/release-planning-v0.39.md`](release-planning/release-planning-v0.39.md)
- [`release-planning/release-planning-v0.40.md`](release-planning/release-planning-v0.40.md)
- [`release-planning/release-planning-v0.41.md`](release-planning/release-planning-v0.41.md)

### `template-files/`

- [`template-files/design-doc-template.md`](template-files/design-doc-template.md)
<!-- docs-map:end -->

# Grimoire — Framework design specs

> **Up:** [↑ Grimoire](../README.md)

This tier holds **framework-internal** design specs — the documents that describe
how Grimoire itself is built. It is **not shipped** to consumer projects (excluded
at both ship gates; see the separation design below). A consumer's *own* project
design docs live one tier up, in [`../../design/`](../../design/README.md).

## Contents

- [agent-roles-design.md](agent-roles-design.md) — Agent role taxonomy and dispatch model.
- [architecture-fitness-design.md](architecture-fitness-design.md) — Architecture fitness functions and rule schema.
- [autonomy-hardening-design.md](autonomy-hardening-design.md) — Hardening the autonomous (Noir) execution path.
- [autonomous-push-prompt-suppression-design.md](autonomous-push-prompt-suppression-design.md) — Auto-approve a guard-passed push for unattended Noir (v3.40).
- [autonomy-scheduling-design.md](autonomy-scheduling-design.md) — Scheduled / cron-driven autonomous work.
- [cost-governance-design.md](cost-governance-design.md) — Token budget, verbosity, and peak-hour policy.
- [doc-assurance-design.md](doc-assurance-design.md) — The deterministic documentation-quality checks.
- [dry-duplication-enforcement-design.md](dry-duplication-enforcement-design.md) — Duplication detection and DRY enforcement.
- [execution-profiles-design.md](execution-profiles-design.md) — Execution-strategy (workflow-variant) profiles.
- [feature-aware-sync-design.md](feature-aware-sync-design.md) — Feature-manifest-driven upstream sync.
- [hard-reset-design.md](hard-reset-design.md) — Archive-then-clear factory reset.
- [html-css-quality-enforcement-design.md](html-css-quality-enforcement-design.md) — HTML/CSS quality gates.
- [issue-label-taxonomy.md](issue-label-taxonomy.md) — Canonical issue-label taxonomy.
- [issue-tracker-design.md](issue-tracker-design.md) — Issue-tracker abstraction and backends.
- [managed-project-tooling-design.md](managed-project-tooling-design.md) — Tooling for managed downstream projects.
- [merge-gate-quality-design.md](merge-gate-quality-design.md) — Pre-merge quality gates.
- [model-effort-profiles-design.md](model-effort-profiles-design.md) — Model/effort distribution profiles.
- [modularization-metrics-design.md](modularization-metrics-design.md) — Modularization and complexity metrics.
- [onboarding-design.md](onboarding-design.md) — First-run onboarding interview and dials.
- [release-planning-workflow-design.md](release-planning-workflow-design.md) — The release-planning workflow.
- [rust-quality-enforcement-design.md](rust-quality-enforcement-design.md) — Rust quality gates.
- [token-efficiency-design.md](token-efficiency-design.md) — Token-efficiency measurement.
- [token-efficiency-enforcement-design.md](token-efficiency-enforcement-design.md) — Token-efficiency enforcement.
- [ux-design-language-design.md](ux-design-language-design.md) — The UX design-language adaptation system.
- [ux-enhancements-design.md](ux-enhancements-design.md) — UX enhancement features.
- [work-paradigm-design.md](work-paradigm-design.md) — Supervised / Weiss / Noir work paradigms.
- [workflow-candidates.md](workflow-candidates.md) — Candidate workflows for the billed fan-out tier.
- [write-capable-workflow-design.md](write-capable-workflow-design.md) — The Noir-only write-capable workflow tier.
- [documentation-separation-design.md](documentation-separation-design.md) — Internal vs. consumer-facing documentation separation (v3.39 "Bulkhead").
- [clean-room-design.md](clean-room-design.md) — Complete framework/project file boundary + surgical regenerate-from-scratch (v3.41 "Clean-Room").
- [grm-namespacing-design.md](grm-namespacing-design.md) — `grm-` skill-namespacing rename + two-tier reference-rewrite contract + migrate engine (v3.42).

## See also

- [↑ Grimoire tier index](../README.md) — the framework-internal docs home.
- [Docs root](../../README.md) — the full documentation map.
- [Design-doc house layout](../../../.claude/skills/grm-design-doc-scaffold/SKILL.md)
  — the section template these specs follow.

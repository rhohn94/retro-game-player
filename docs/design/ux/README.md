# UX Design Language

> **Up:** [↑ Design docs](../README.md)

This tier contains the per-project UX design language: design tokens, component
recipes, and the adaptation of upstream design-language conventions.

## Contents

- [design-language.md](design-language.md) — Per-project UX design language authority (adaptation of upstream conventions)
- [theme.md](theme.md) — Design token tier: color, typography, spacing, and surface tokens
- [components.md](components.md) — Component recipe tier: machine-addressable named component patterns

## Visual inspection (`gui-visual-inspection-cli`)

The framework-required visual-inspection capability renders this UI language
headlessly and captures a screenshot + DOM dump as a CI-safe smoke artifact.
The command (`node scripts/visual-inspect.mjs`, the `inspect`/`smoke` recipe
targets) and how smoke exercises the served UI are documented in
[../runtime-verification-design.md](../runtime-verification-design.md).

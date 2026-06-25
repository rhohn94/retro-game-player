# Autonomous-push prompt suppression

> **Up:** [↑ Design index](README.md)

> Design gate for v3.40. Makes the guard-passed `git push` auto-approve — no
> interactive permission prompt — but **only** for a genuinely unattended Noir
> project that has explicitly opted in. Every other posture still gets the human
> prompt. Builds on the `#64` push-approval envelope from
> [autonomy-hardening-design.md](autonomy-hardening-design.md).

## Motivation

Under Noir, the integration master drives a release end-to-end unsupervised and
stops at exactly one point: the final `git push`. `push-guard.sh` validates the
push (marker + allowlist + denied destructive flags) and then exits 0, which
hands the push to the normal Claude Code permission prompt — a human click. For a
project that has *deliberately* opted into unattended operation, that last click
is the only thing standing between "fully autonomous release" and "autonomous up
to the push." The opt-in `autonomous-push` config existed (`#64`) but had no
mechanism to actually suppress the prompt — it only documented intent and wrote
an audit-log line.

## Goals

- Suppress the interactive push prompt for a guard-passed push **iff** the
  project is Noir **and** `autonomous-push.enabled` is true.
- Keep every existing rail intact: the suppression runs only *after* the full
  guard (marker, allowlist, denied destructive flags) has passed.
- Fail closed for every other posture — Supervised, Weiss, or Noir without the
  opt-in all fall through to the human prompt unchanged.
- Add an issue-tracker MCP permissions allowlist so an unattended run can file
  follow-up tickets without per-call prompts.

## Non-goals

- Relaxing any guard predicate (marker, allowlist, destructive-flag denial) —
  those are unchanged; suppression is strictly downstream of them.
- Auto-approving destructive pushes (`--force`, `--delete`, ref deletion) — still
  denied regardless of paradigm.
- Enabling autonomous push by default — it remains opt-in per project.

This **supersedes** the autonomy-hardening non-goal "Relaxing `push-guard.sh` …
the safe-by-default human-gated push": the safe default is preserved (human-gated
unless opted in), but an opted-in Noir project may now push without the prompt.

## Scope

- `claude-code/.claude/hooks/push-guard.sh` (+ workflow-bootstrap golden copy)
  and the root dogfood copy: paradigm-aware `should_auto_allow()` plus a
  `PreToolUse` `permissionDecision: allow` emission after the guard passes.
- `claude-code/.claude/settings.json` (+ golden) and root: issue-tracker MCP
  permissions allowlist.
- **Copilot is out of enforcement scope** — Copilot has no `push-guard.sh`
  equivalent (push is gated by the `git-hooks/pre-push` allowlist, never an
  agent prompt), so on Copilot push stays a human action. Documented in
  `AGENTS.md`.

## Design

`push-guard.sh` gains three config readers — `read_config`, `work_paradigm`,
`autonomous_push_enabled` — and the predicate
`should_auto_allow(paradigm, autopush) -> paradigm == "Noir" and autopush is
True`. After `validate_push` passes for every push in the command and the
approval is audit-logged, the hook checks the predicate; when true it prints a
`PreToolUse` hook output with `permissionDecision: "allow"` and exits 0,
suppressing the prompt. When false it exits 0 silently and the normal prompt
gates the push. Config values are read through a `_scalar()` unwrapper so a value
may be a bare scalar or a `{"value": …}` block.

## Acceptance / validation

- `push-guard.sh --self-test` PASSES, including the new `should_auto_allow`
  truth table: `(Noir, True)→True`; `(Noir, False)`, `(Supervised, *)`,
  `(Weiss, True)` all `→False`.
- A guard-passed push under Noir + `autonomous-push.enabled` emits the `allow`
  decision; every other posture exits silently (human prompt gates).
- Destructive flags stay denied regardless of paradigm.
- Flavor parity green; copilot documents the no-enforcement posture in
  `AGENTS.md`.

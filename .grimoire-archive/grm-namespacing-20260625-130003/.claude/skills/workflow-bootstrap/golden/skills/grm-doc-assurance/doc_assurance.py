#!/usr/bin/env python3
"""doc-assurance — deterministic checks over a Grimoire repo's own docs.

Checks: flavor-parity, design-layout, links, docs-map, release-consistency,
        skill-budget, lean-index, monolith-cap.
Read-only except --write-map. Report-only unless --strict (non-zero on findings).

Usage:
  doc_assurance.py [check ...] [--strict] [--write-map] [--root PATH]
  (no checks named ⇒ run all)

design-layout check (check 2)
------------------------------
A design doc passes when it satisfies EITHER the legacy pattern set OR the
house-template section set.  A doc matching neither still fails.

  Legacy pattern set (pre-house-template docs):
    ALL of: motivation · goals · non-goal · validation|idempotency

  House-template section set (docs/design/README.md house layout):
    ALL of: motivation · scope · design|acceptance

The check is deterministic: each doc is evaluated against both sets
independently; a doc that satisfies at least one set emits no findings.
A failing doc emits a single "does not satisfy either pattern set" finding.
Unresolved open-questions markers (TODO/TBD/???) in ## Open questions are
reported separately regardless of which layout the doc uses.

flavor-parity check (check 1)
------------------------------
Extended in WH-7 to cover root ↔ claude-code ↔ copilot three-flavor
structural parity for docs file-name sets.  Known-intentional gaps are
pre-populated in DOCS_PARITY_ALLOW so the check never floods for them.

lean-index check (check 9)
---------------------------
Index pages (README.md files under docs/) must be ≤ 6 KB and contain ≥ 3
markdown links. Aggregating root indexes (docs/README.md,
docs/design/README.md) are exempt from the size cap; the link-density rule
still applies to all non-exempt index pages.

monolith-cap check (check 10)
------------------------------
Leaf docs (non-README.md files under docs/) exceeding 20 KB are flagged
with a warn-only message (never a hard gate). A hardcoded exempt list covers
files that are intentionally comprehensive. This check is forward-looking:
existing over-cap files are pre-exempted; new files that exceed the cap are
flagged.
"""
import os, re, sys, json, glob

CHECKS = [
    "flavor-parity", "design-layout", "links", "docs-map",
    "release-consistency", "skill-budget", "lean-index", "monolith-cap",
]

# v1.29 context-efficiency budgets (bytes).
SKILL_BUDGET = 12_000
CLAUDE_BUDGET = 10_000

# Paths whose root vs claude-code copies are intentionally allowed to differ.
PARITY_ALLOW_DIVERGENT = {"CLAUDE.md"}  # paradigm stamp differs by flavor

# ── WH-7: Three-flavor docs parity allow-list ───────────────────────────
# Each entry is a (flavor_a, flavor_b, relative_docs_path) tuple.
# "flavor_a" has the file; "flavor_b" does not — and this is intentional.
# Flavors are: "root", "claude-code", "copilot".
#
# Rules for additions:
#   - Only add an entry after verifying the gap is *intentional* (not a
#     forgotten sync). Grep for the design doc in both flavors before adding.
#   - Never add entries for skill-set gaps (those are caught by the skill
#     presence check above, not this docs check).
DOCS_PARITY_ALLOW = frozenset({
    # ── docs/grimoire/ tier ────────────────────────────────────────────
    # WH-9: root + copilot now both have grimoire/README.md; no gap entries needed.
    # copilot docs/grimoire is a subset — cost/validation spikes are root-only data
    ("claude-code", "copilot", "docs/grimoire/issue-tracker-cost-spike.md"),
    ("claude-code", "copilot", "docs/grimoire/issue-tracker-cost-validation.md"),
    ("root",        "copilot", "docs/grimoire/issue-tracker-cost-spike.md"),
    ("root",        "copilot", "docs/grimoire/issue-tracker-cost-validation.md"),

    # ── docs/design/ux/ — all three flavors now have README (WH-9) ────
    # components.md and theme.md are in claude-code but not copilot
    ("claude-code", "copilot", "docs/design/ux/components.md"),
    ("claude-code", "copilot", "docs/design/ux/theme.md"),
    # root ↔ copilot gaps (root has them via root→claude-code inheritance)
    ("root", "copilot", "docs/design/ux/components.md"),
    ("root", "copilot", "docs/design/ux/theme.md"),

    # ── docs/design/ tier — claude-code ↔ copilot gaps ────────────────
    # Claude-Code-only features (Workflow primitive, write-capable tier, UX demo)
    ("claude-code", "copilot", "docs/design/release-planning-workflow-design.md"),
    ("claude-code", "copilot", "docs/design/ux-design-language-design.md"),
    ("claude-code", "copilot", "docs/design/ux-enhancements-design.md"),
    ("claude-code", "copilot", "docs/design/workflow-candidates.md"),
    ("claude-code", "copilot", "docs/design/write-capable-workflow-design.md"),
    # copilot has feature-manifest.md under design/ (not in claude-code or root)
    ("copilot", "claude-code", "docs/design/feature-manifest.md"),
    ("copilot", "root",        "docs/design/feature-manifest.md"),

    # ── docs/design/ tier — root-only files (this project's own docs) ─
    # Root carries the full historical design-doc corpus; claude-code ships
    # only the subset that applies to a freshly-bootstrapped downstream project.
    # Files below are root-only by intention (project history / in-flight spikes).
    ("root", "claude-code", "docs/design/agent-teardown-design.md"),
    ("root", "claude-code", "docs/design/build-recipe-interface-design.md"),
    ("root", "claude-code", "docs/design/changelog-surface-design.md"),
    ("root", "claude-code", "docs/design/coding-practices-audit-design.md"),
    ("root", "claude-code", "docs/design/component-catalog-architecture-design.md"),
    ("root", "claude-code", "docs/design/component-compatibility-matrix.md"),
    ("root", "claude-code", "docs/design/component-taxonomy.md"),
    ("root", "claude-code", "docs/design/context-efficiency-design.md"),
    ("root", "claude-code", "docs/design/defaults-quickstart-design.md"),
    ("root", "claude-code", "docs/design/dependency-channel-design.md"),
    ("root", "claude-code", "docs/design/deploy-environment-design.md"),
    ("root", "claude-code", "docs/design/dispatch-hardening-design.md"),
    ("root", "claude-code", "docs/design/environment-manager-design.md"),
    ("root", "claude-code", "docs/design/fleet-status-contract.md"),
    ("root", "claude-code", "docs/design/footprint-reduction-design.md"),
    ("root", "claude-code", "docs/design/git-protocol-governance-design.md"),
    ("root", "claude-code", "docs/design/github-pr-integration-design.md"),
    ("root", "claude-code", "docs/design/grimoire-release-server-design.md"),
    ("root", "claude-code", "docs/design/integration-branch-integrity-design.md"),
    ("root", "claude-code", "docs/design/iterate-on-facet-design.md"),
    ("root", "claude-code", "docs/design/mcp-expansion-audit.md"),
    ("root", "claude-code", "docs/design/mcp-server-design.md"),
    ("root", "claude-code", "docs/design/noir-iterative-loop-design.md"),
    ("root", "claude-code", "docs/design/paradigm-discoverability-design.md"),
    ("root", "claude-code", "docs/design/project-manager-role-design.md"),
    ("root", "claude-code", "docs/design/qa-agent-design.md"),
    ("root", "claude-code", "docs/design/quick-start-templates-design.md"),
    ("root", "claude-code", "docs/design/release-distribution-design.md"),
    ("root", "claude-code", "docs/design/release-phase-model-design.md"),
    ("root", "claude-code", "docs/design/run-metadata-artifact-design.md"),
    ("root", "claude-code", "docs/design/runtime-verification-design.md"),
    ("root", "claude-code", "docs/design/scripting-unification-design.md"),
    ("root", "claude-code", "docs/design/status-broker-design.md"),
    ("root", "claude-code", "docs/design/stealth-mode-design.md"),
    ("root", "claude-code", "docs/design/sync-reliability-design.md"),
    ("root", "claude-code", "docs/design/web-app-aura-adoption-design.md"),
    ("root", "claude-code", "docs/design/web-app-support-design.md"),
    ("root", "claude-code", "docs/design/wiki-doc-hierarchy-design.md"),
    ("root", "claude-code", "docs/design/worktree-port-allocation-design.md"),
    # root ↔ copilot: all of the root-only files above are also absent in copilot
    ("root", "copilot", "docs/design/agent-teardown-design.md"),
    ("root", "copilot", "docs/design/build-recipe-interface-design.md"),
    ("root", "copilot", "docs/design/changelog-surface-design.md"),
    ("root", "copilot", "docs/design/coding-practices-audit-design.md"),
    ("root", "copilot", "docs/design/component-catalog-architecture-design.md"),
    ("root", "copilot", "docs/design/component-compatibility-matrix.md"),
    ("root", "copilot", "docs/design/component-taxonomy.md"),
    ("root", "copilot", "docs/design/context-efficiency-design.md"),
    ("root", "copilot", "docs/design/defaults-quickstart-design.md"),
    ("root", "copilot", "docs/design/dependency-channel-design.md"),
    ("root", "copilot", "docs/design/deploy-environment-design.md"),
    ("root", "copilot", "docs/design/dispatch-hardening-design.md"),
    ("root", "copilot", "docs/design/environment-manager-design.md"),
    ("root", "copilot", "docs/design/fleet-status-contract.md"),
    ("root", "copilot", "docs/design/footprint-reduction-design.md"),
    ("root", "copilot", "docs/design/git-protocol-governance-design.md"),
    ("root", "copilot", "docs/design/github-pr-integration-design.md"),
    ("root", "copilot", "docs/design/grimoire-release-server-design.md"),
    ("root", "copilot", "docs/design/integration-branch-integrity-design.md"),
    ("root", "copilot", "docs/design/iterate-on-facet-design.md"),
    ("root", "copilot", "docs/design/mcp-expansion-audit.md"),
    ("root", "copilot", "docs/design/mcp-server-design.md"),
    ("root", "copilot", "docs/design/noir-iterative-loop-design.md"),
    ("root", "copilot", "docs/design/paradigm-discoverability-design.md"),
    ("root", "copilot", "docs/design/project-manager-role-design.md"),
    ("root", "copilot", "docs/design/qa-agent-design.md"),
    ("root", "copilot", "docs/design/quick-start-templates-design.md"),
    ("root", "copilot", "docs/design/release-distribution-design.md"),
    ("root", "copilot", "docs/design/release-phase-model-design.md"),
    # root also has this (from root-only set) + copilot doesn't
    ("root", "copilot", "docs/design/release-planning-workflow-design.md"),
    ("root", "copilot", "docs/design/run-metadata-artifact-design.md"),
    ("root", "copilot", "docs/design/runtime-verification-design.md"),
    ("root", "copilot", "docs/design/scripting-unification-design.md"),
    ("root", "copilot", "docs/design/status-broker-design.md"),
    ("root", "copilot", "docs/design/stealth-mode-design.md"),
    ("root", "copilot", "docs/design/sync-reliability-design.md"),
    ("root", "copilot", "docs/design/ux-design-language-design.md"),
    ("root", "copilot", "docs/design/ux-enhancements-design.md"),
    ("root", "copilot", "docs/design/web-app-aura-adoption-design.md"),
    ("root", "copilot", "docs/design/web-app-support-design.md"),
    ("root", "copilot", "docs/design/wiki-doc-hierarchy-design.md"),
    ("root", "copilot", "docs/design/workflow-candidates.md"),
    ("root", "copilot", "docs/design/worktree-port-allocation-design.md"),
    ("root", "copilot", "docs/design/write-capable-workflow-design.md"),

    # ── docs/ top-level — root-only files ─────────────────────────────
    # Root is the actual project; it has release-planning archives, ledger, etc.
    # claude-code/docs/ ships only the subset a new project needs to bootstrap.
    ("root", "claude-code", "docs/qa-ledger.md"),
    ("root", "claude-code", "docs/token-efficiency-audit.md"),
    ("root", "claude-code", "docs/token-efficiency-baseline.md"),
    ("root", "claude-code", "docs/token-efficiency-trim-decision.md"),
    ("root", "claude-code", "docs/version-history.md"),
    ("root", "claude-code", "docs/web-app-aura-adoption-guide.md"),
    ("root", "claude-code", "docs/web-app-deployment-protocol.md"),
    # root ↔ copilot: same files absent in copilot
    ("root", "copilot", "docs/qa-ledger.md"),
    ("root", "copilot", "docs/token-efficiency-audit.md"),
    ("root", "copilot", "docs/token-efficiency-baseline.md"),
    ("root", "copilot", "docs/token-efficiency-trim-decision.md"),
    ("root", "copilot", "docs/version-history.md"),
    ("root", "copilot", "docs/web-app-aura-adoption-guide.md"),
    ("root", "copilot", "docs/web-app-deployment-protocol.md"),

    # ── docs/coding-standards/ — WH-9 created README in root + copilot ──
    # All three flavors now have docs/coding-standards/README.md; no gap entries needed.

    # ── docs/ top-level — claude-code ↔ copilot gaps ──────────────────
    # WH-9: copilot now has docs/README.md; no README gap entries needed.
    # claude-code ships an execution-profile-spike not in copilot
    ("claude-code", "copilot", "docs/execution-profile-spike-s1.md"),
    # root has execution-profile-spike; it's in claude-code but not copilot
    # (already covered transitively above via root→claude-code + claude-code→copilot)
    ("root", "copilot", "docs/execution-profile-spike-s1.md"),
})

# Release-planning archive pattern: root-only, auto-matched by regex.
_RELEASE_PLAN_RE = re.compile(r"^docs/release-planning-v[\d.]+\.md$")

# ── lean-index (check 9) constants ─────────────────────────────────────
LEAN_INDEX_SIZE_CAP  = 6_144   # 6 KB — individual index page budget
LEAN_INDEX_MIN_LINKS = 3       # minimum markdown links in an index page
# Size-cap exempt: aggregating multi-tier index pages that must list many
# sub-docs to be useful.  Link-density rule still applies.
LEAN_INDEX_SIZE_EXEMPT = frozenset({
    "docs/README.md",           # repo-root doc map (many tiers)
    "docs/design/README.md",    # design-doc catalog (all design docs)
})
# claude-code flavor equivalents (checked when running --root claude-code/)
_LEAN_INDEX_CC_SIZE_EXEMPT = frozenset({
    "docs/README.md",
    "docs/design/README.md",
})

# ── monolith-cap (check 10) constants ──────────────────────────────────
MONOLITH_CAP = 20_480   # 20 KB — warn-only cap for leaf docs

# Intentionally comprehensive files that are allowed to exceed the cap.
# Add new entries here rather than raising the cap threshold.
MONOLITH_CAP_EXEMPT = frozenset({
    # Always-exempt by policy
    "docs/coding-standards.md",
    "docs/version-history.md",
    "docs/qa-ledger.md",
    "docs/integration-workflow.md",
    # Existing large design docs (pre-WH-8 corpus; exempt so this check is
    # forward-looking rather than retroactively flagging the whole corpus).
    "docs/design/agent-roles-design.md",
    "docs/design/autonomy-scheduling-design.md",
    "docs/design/cost-governance-design.md",
    "docs/design/dependency-channel-design.md",
    "docs/design/execution-profiles-design.md",
    "docs/design/feature-aware-sync-design.md",
    "docs/design/fleet-status-contract.md",
    "docs/design/hard-reset-design.md",
    "docs/design/issue-tracker-design.md",
    "docs/design/model-effort-profiles-design.md",
    "docs/design/onboarding-design.md",
    "docs/design/project-manager-role-design.md",
    "docs/design/stealth-mode-design.md",
    "docs/design/token-efficiency-design.md",
    "docs/design/ux-design-language-design.md",
    "docs/design/ux-enhancements-design.md",
    "docs/design/web-app-support-design.md",
    "docs/design/wiki-doc-hierarchy-design.md",
    "docs/design/work-paradigm-design.md",
    "docs/design/write-capable-workflow-design.md",
    "docs/grimoire/docs-organization-design.md",
    "docs/roadmap.md",
    "docs/web-app-deployment-protocol.md",
})
# release-planning archives (root-only, always exempt from monolith cap)
_MONOLITH_CAP_RELEASE_PLAN_RE = re.compile(r"^docs/release-planning-v[\d.]+\.md$")


def _docs_filenames(root, flavor_root):
    """Return a set of docs-relative paths (e.g. 'docs/design/foo.md')."""
    result = set()
    for p in glob.glob(f"{flavor_root}/docs/**/*.md", recursive=True):
        result.add(os.path.relpath(p, flavor_root))
    return result


def find_root(start):
    d = os.path.abspath(start)
    while d != "/":
        if os.path.exists(os.path.join(d, "CLAUDE.md")) and os.path.isdir(os.path.join(d, "claude-code")):
            return d
        d = os.path.dirname(d)
    raise SystemExit("repo root not found (need CLAUDE.md + claude-code/)")


def rel(root, p):
    return os.path.relpath(p, root)


def _is_docs_gap_allowed(flavor_a, flavor_b, doc_path, allow_set):
    """Return True if the gap (flavor_a has doc_path, flavor_b does not) is in the allow-list."""
    if _RELEASE_PLAN_RE.match(doc_path):
        return True  # release-planning archives are always root-only; never flag
    return (flavor_a, flavor_b, doc_path) in allow_set


# ── Check 1: flavor parity ──────────────────────────────────────────────
def check_flavor_parity(root, _allow_set=None):
    """Three-flavor structural parity: root ↔ claude-code ↔ copilot.

    Checks:
      1. Skill presence parity between root and claude-code (existing behaviour).
      2. Content parity for the must-match file set (existing behaviour).
      3. [WH-7] Docs file-name set parity: root ↔ claude-code ↔ copilot,
         with a pre-populated allow-list for known-intentional gaps.
    """
    if _allow_set is None:
        _allow_set = DOCS_PARITY_ALLOW
    findings = []

    # ── (1) Skill presence parity: root ↔ claude-code ──────────────────
    cc_skills = {os.path.basename(os.path.dirname(p))
                 for p in glob.glob(f"{root}/claude-code/.claude/skills/*/SKILL.md")}
    rt_skills = {os.path.basename(os.path.dirname(p))
                 for p in glob.glob(f"{root}/.claude/skills/*/SKILL.md")}
    for s in sorted(cc_skills - rt_skills):
        findings.append(f"skill present in claude-code but not root: {s}")
    for s in sorted(rt_skills - cc_skills):
        findings.append(f"skill present in root but not claude-code: {s}")

    # ── (2) Content parity for must-match set ───────────────────────────
    must_match = ["docs/coding-standards.md",
                  ".claude/skills/sync-from-upstream/feature-manifest.md"]
    must_match += [rel(root, p) for p in glob.glob(f"{root}/docs/coding-standards/*.md")]
    for rp in must_match:
        if rp in PARITY_ALLOW_DIVERGENT:
            continue
        a, b = f"{root}/{rp}", f"{root}/claude-code/{rp}"
        if not os.path.exists(b):
            findings.append(f"must-match file missing in claude-code: {rp}")
            continue
        if open(a).read() != open(b).read():
            findings.append(f"must-match file differs root vs claude-code: {rp}")

    # ── (3) [WH-7] Docs file-name set parity: three flavors ─────────────
    copilot_root = os.path.join(root, "copilot")
    if not os.path.isdir(copilot_root):
        # copilot flavor absent in this repo — skip three-flavor check
        return findings

    rt_docs = _docs_filenames(root, root)
    cc_docs = _docs_filenames(root, os.path.join(root, "claude-code"))
    cp_docs = _docs_filenames(root, copilot_root)
    # Normalise copilot paths: copilot files live under copilot/docs/…,
    # but _docs_filenames already returns them relative to copilot_root,
    # e.g. "docs/design/foo.md".

    pairs = [
        ("root",        rt_docs, "claude-code", cc_docs),
        ("claude-code", cc_docs, "copilot",     cp_docs),
        ("root",        rt_docs, "copilot",     cp_docs),
    ]
    for fa, fa_docs, fb, fb_docs in pairs:
        # files in fa but not fb
        for doc in sorted(fa_docs - fb_docs):
            if not _is_docs_gap_allowed(fa, fb, doc, _allow_set):
                findings.append(
                    f"docs file in {fa} but not {fb} (not allow-listed): {doc}"
                )
        # files in fb but not fa
        for doc in sorted(fb_docs - fa_docs):
            if not _is_docs_gap_allowed(fb, fa, doc, _allow_set):
                findings.append(
                    f"docs file in {fb} but not {fa} (not allow-listed): {doc}"
                )

    return findings


# ── Check 2: design-doc layout ──────────────────────────────────────────
# Legacy pattern set — pre-house-template docs must have all four.
_LEGACY_SECTIONS = ["motivation", "goals", "non-goal", "validation|idempotency"]
# House-template section set — docs/design/README.md house layout; all three required.
_HOUSE_SECTIONS  = ["motivation", "scope", "design|acceptance"]

def _has_section(low, pattern):
    """Return True if any heading in *low* matches any '|'-separated alt."""
    return any(re.search(rf"#+ .*{alt}", low) for alt in pattern.split("|"))

def _layout_ok(low, section_list):
    return all(_has_section(low, s) for s in section_list)

def check_design_layout(root):
    findings = []
    for p in sorted(glob.glob(f"{root}/docs/design/*-design.md")):
        low = open(p).read().lower()
        legacy_ok = _layout_ok(low, _LEGACY_SECTIONS)
        house_ok  = _layout_ok(low, _HOUSE_SECTIONS)
        if not legacy_ok and not house_ok:
            findings.append(
                f"{rel(root,p)}: does not satisfy either the legacy section set "
                f"(motivation/goals/non-goal/validation) or the house-template set "
                f"(motivation/scope/design-or-acceptance)"
            )
        if "## open questions" in low and re.search(r"todo|tbd|\?\?\?", low):
            findings.append(f"{rel(root,p)}: unresolved open-questions marker")
    return findings


# ── Check 3: link integrity ─────────────────────────────────────────────
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
FENCE_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`[^`]*`")
def _strip_code(text):
    # Links inside fenced or inline code are examples, not real references.
    text = FENCE_RE.sub("", text)
    return INLINE_CODE_RE.sub("", text)
def check_links(root):
    findings = []
    md = [p for p in glob.glob(f"{root}/**/*.md", recursive=True)
          if "/.git/" not in p and "/.scaffold-base/" not in p]
    for p in md:
        base = os.path.dirname(p)
        for m in LINK_RE.finditer(_strip_code(open(p).read())):
            t = m.group(1).strip()
            if t.startswith(("http://", "https://", "#", "mailto:")):
                continue
            t = t.split("#", 1)[0].split("?", 1)[0]
            if not t or t.startswith("<"):
                continue
            target = os.path.normpath(os.path.join(base, t))
            if not os.path.exists(target):
                findings.append(f"{rel(root,p)} → dead link: {t}")
    return findings


# ── Check 4: docs map ───────────────────────────────────────────────────
def docs_md_files(root):
    return sorted(rel(root, p) for p in glob.glob(f"{root}/docs/**/*.md", recursive=True)
                  if os.path.basename(p) != "README.md")
def build_map(root):
    files = docs_md_files(root)
    lines = ["# Documentation map", "",
             "> Generated + validated by `doc-assurance` (check `docs-map`). Lists every",
             "> file under `docs/`. Regenerate with `doc_assurance.py docs-map --write-map`.",
             ""]
    top = [f for f in files if "/" not in f[len("docs/"):]]
    design = [f for f in files if f.startswith("docs/design/")]
    other = [f for f in files if f not in top and f not in design]
    def section(title, fs):
        if not fs: return []
        out = [f"## {title}", ""]
        for f in fs:
            out.append(f"- [`{f[len('docs/'):]}`]({f[len('docs/'):]})")
        out.append("")
        return out
    lines += section("Top level", top)
    lines += section("Design (`design/`)", design)
    lines += section("Other", other)
    return "\n".join(lines) + "\n"
def check_docs_map(root, write=False):
    mp = f"{root}/docs/README.md"
    if write:
        open(mp, "w").write(build_map(root))
        return []
    findings = []
    if not os.path.exists(mp):
        return ["docs/README.md (documentation map) missing — run with --write-map"]
    listed = set(re.findall(r"\]\(([^)]+\.md)\)", open(mp).read()))
    listed = {os.path.normpath(os.path.join("docs", x)) for x in listed}
    actual = set(docs_md_files(root))
    for f in sorted(actual - listed):
        findings.append(f"docs map missing entry: {f}")
    for f in sorted(listed - actual):
        findings.append(f"docs map stale entry (no file): {f}")
    return findings


# ── Check 5: release consistency ────────────────────────────────────────
VER_RE = re.compile(r"^##\s+v(\d+\.\d+)", re.M)
def check_release_consistency(root):
    findings = []
    vh = open(f"{root}/docs/version-history.md").read()
    rm = open(f"{root}/docs/roadmap.md").read()
    hist = set(VER_RE.findall(vh))
    # roadmap shipped versions: a vX.Y section whose body says Shipped/released
    shipped = set()
    for m in re.finditer(r"^##\s+v(\d+\.\d+)(.*?)(?=^##\s+v|\Z)", rm, re.S | re.M):
        if re.search(r"shipped|released", m.group(2), re.I):
            shipped.add(m.group(1))
    for v in sorted(hist - shipped, key=lambda s: tuple(map(int, s.split(".")))):
        findings.append(f"v{v} in version-history but not marked Shipped in roadmap")
    # manifest-version monotonic int + framework-version >= newest shipped
    mani = open(f"{root}/.claude/skills/sync-from-upstream/feature-manifest.md").read()
    mv = re.search(r"manifest-version:\s*(\d+)", mani)
    if not mv:
        findings.append("feature-manifest.md: no integer manifest-version")
    cfg = json.load(open(f"{root}/.claude/grimoire-config.json"))
    fw = cfg.get("framework-version", "").lstrip("v")
    if hist:
        newest = max(hist, key=lambda s: tuple(map(int, s.split("."))))
        if fw and tuple(map(int, fw.split("."))) < tuple(map(int, newest.split("."))):
            findings.append(f"framework-version {fw} < newest shipped v{newest}")
    return findings


# ── Check 6: skill / always-loaded size budget (v1.29, #55/#56) ─────────
def check_skill_budget(root):
    findings = []
    for p in sorted(glob.glob(f"{root}/.claude/skills/*/SKILL.md")):
        n = os.path.getsize(p)
        if n > SKILL_BUDGET:
            findings.append(f"{rel(root,p)}: {n} bytes > {SKILL_BUDGET} budget "
                            f"(split a lean head + reference.md)")
    cm = f"{root}/CLAUDE.md"
    if os.path.exists(cm) and os.path.getsize(cm) > CLAUDE_BUDGET:
        findings.append(f"CLAUDE.md: {os.path.getsize(cm)} bytes > {CLAUDE_BUDGET} budget")
    return findings


# ── Check 9: lean-index ─────────────────────────────────────────────────
_MD_LINK_RE = re.compile(r"\[[^\]]+\]\([^)]+\)")

def check_lean_index(root):
    """Index pages (README.md under docs/) must be ≤ 6 KB and link-dense (≥ 3 links).

    Size-cap exempt: aggregating root indexes listed in LEAN_INDEX_SIZE_EXEMPT.
    Link-density rule applies to all non-exempt index pages.
    """
    findings = []
    for p in sorted(glob.glob(f"{root}/docs/**/README.md", recursive=True)):
        rp = rel(root, p)
        content = open(p).read()
        size = os.path.getsize(p)
        links = _MD_LINK_RE.findall(content)

        if rp not in LEAN_INDEX_SIZE_EXEMPT and size > LEAN_INDEX_SIZE_CAP:
            findings.append(
                f"{rp}: index page {size} bytes > {LEAN_INDEX_SIZE_CAP} budget "
                f"(lean-index rule)"
            )
        if len(links) < LEAN_INDEX_MIN_LINKS:
            findings.append(
                f"{rp}: index page has only {len(links)} links "
                f"(minimum {LEAN_INDEX_MIN_LINKS}, lean-index rule)"
            )
    return findings


# ── Check 10: monolith-cap ───────────────────────────────────────────────
def check_monolith_cap(root):
    """Warn when a leaf doc (non-README.md under docs/) exceeds 20 KB.

    Warn-only — never a hard gate.  Files in MONOLITH_CAP_EXEMPT and
    release-planning archives are never flagged.
    """
    findings = []
    for p in sorted(glob.glob(f"{root}/docs/**/*.md", recursive=True)):
        if os.path.basename(p) == "README.md":
            continue
        rp = rel(root, p)
        if rp in MONOLITH_CAP_EXEMPT:
            continue
        if _MONOLITH_CAP_RELEASE_PLAN_RE.match(rp):
            continue
        size = os.path.getsize(p)
        if size > MONOLITH_CAP:
            findings.append(
                f"{rp}: {size} bytes > {MONOLITH_CAP} monolith cap "
                f"(consider splitting leaf + index)"
            )
    return findings


# ── Self-test ────────────────────────────────────────────────────────────
def self_test():
    """In-memory unit tests for check_design_layout and check_flavor_parity.

    Design-layout covers: legacy-passing doc, house-template-passing doc, doc
    satisfying both, doc satisfying neither, and the open-questions marker rule.

    Flavor-parity covers (WH-7): file in claude-code but not copilot is flagged
    when not allow-listed; same gap passes when allow-listed; release-planning
    archives are never flagged.

    Returns (passed, failed, lines).
    """
    import tempfile, os as _os

    def _fake_doc(content):
        """Write content to a temp file and return its path."""
        fd, path = tempfile.mkstemp(suffix="-design.md")
        _os.write(fd, content.encode())
        _os.close(fd)
        return path

    cases = []

    def run_layout(content):
        """Run check_design_layout against a single in-memory doc."""
        path = _fake_doc(content)
        tmpdir = _os.path.dirname(path)
        # Monkey-patch glob so the check sees only our file.
        import glob as _glob
        orig = _glob.glob
        _glob.glob = lambda pat, **kw: [path] if pat.endswith("*-design.md") else orig(pat, **kw)
        try:
            findings = check_design_layout(tmpdir)
        finally:
            _glob.glob = orig
            _os.unlink(path)
        return findings

    # 1. Legacy-passing doc (motivation + goals + non-goal + validation) — no findings.
    legacy_doc = (
        "# Feature\n"
        "## Motivation\nWhy.\n"
        "## Goals\n- goal\n"
        "## Non-goals\nNone.\n"
        "## Validation\nIdempotent.\n"
    )
    f = run_layout(legacy_doc)
    cases.append(("legacy-pattern doc passes (no findings)", not f))

    # 2. House-template doc (motivation + scope + design) — no findings.
    house_doc = (
        "# Feature\n"
        "## Motivation\nWhy.\n"
        "## Scope\nWhat.\n"
        "## Design\nHow.\n"
        "## Acceptance\n- [ ] done\n"
    )
    f = run_layout(house_doc)
    cases.append(("house-template doc passes (no findings)", not f))

    # 3. House-template doc with only motivation + scope + acceptance (no ## Design) — still passes.
    house_no_design = (
        "# Feature\n"
        "## Motivation\nWhy.\n"
        "## Scope\nWhat.\n"
        "## Acceptance\n- [ ] done\n"
    )
    f = run_layout(house_no_design)
    cases.append(("house-template doc with acceptance but no design section passes", not f))

    # 4. Doc satisfying BOTH patterns — no findings.
    both_doc = (
        "# Feature\n"
        "## Motivation\nWhy.\n"
        "## Goals\n- g\n"
        "## Non-goals\nNone.\n"
        "## Scope\nWhat.\n"
        "## Design\nHow.\n"
        "## Validation / Idempotency\nOK.\n"
        "## Acceptance\n- [ ] done\n"
    )
    f = run_layout(both_doc)
    cases.append(("doc satisfying both patterns passes (no findings)", not f))

    # 5. Doc satisfying neither — exactly one layout finding.
    neither_doc = (
        "# Feature\n"
        "## 1. Problem\nThe issue.\n"
        "## 2. Solution\nThe fix.\n"
        "## 3. Out of scope\nNone.\n"
    )
    f = run_layout(neither_doc)
    layout_findings = [x for x in f if "does not satisfy" in x]
    cases.append(("doc satisfying neither set emits one layout finding", len(layout_findings) == 1))

    # 6. Unresolved open-questions marker fires regardless of layout.
    open_q_doc = (
        "# Feature\n"
        "## Motivation\nWhy.\n"
        "## Scope\nWhat.\n"
        "## Design\nHow.\n"
        "## Open questions\nTODO: decide something.\n"
    )
    f = run_layout(open_q_doc)
    oq_findings = [x for x in f if "unresolved" in x]
    cases.append(("open-questions marker fires on passing house-template doc", len(oq_findings) == 1))

    # 7. Doc with motivation + scope but NO design or acceptance — still fails house-template.
    house_incomplete = (
        "# Feature\n"
        "## Motivation\nWhy.\n"
        "## Scope\nWhat.\n"
    )
    f = run_layout(house_incomplete)
    layout_findings = [x for x in f if "does not satisfy" in x]
    cases.append(("motivation+scope only (no design/acceptance) fails house-template", len(layout_findings) == 1))

    # ── WH-7: Three-flavor docs parity self-tests ────────────────────────
    # These tests exercise check_flavor_parity's new docs file-name set comparison
    # by calling the function with synthetic fake_docs sets, using a custom
    # _allow_set argument (the function accepts it as an override for testing).

    def _run_parity_with_docs(rt_docs, cc_docs, cp_docs, allow_set=frozenset()):
        """Simulate check_flavor_parity's three-flavor docs check only.

        Directly exercises the inner logic without touching the filesystem,
        by constructing a synthetic root with fake flavor directories.
        Returns the docs-parity findings list.
        """
        import tempfile as _tmp, os as _os2

        # Build a minimal synthetic tree: root/ with claude-code/ and copilot/ subdirs
        # and the required docs files.
        tmproot = _tmp.mkdtemp()
        try:
            for flavor, docs in [(".", rt_docs), ("claude-code", cc_docs), ("copilot", cp_docs)]:
                flavor_root = _os2.path.join(tmproot, flavor)
                for doc in docs:
                    fpath = _os2.path.join(flavor_root, doc)
                    _os2.makedirs(_os2.path.dirname(fpath), exist_ok=True)
                    open(fpath, "w").write("# stub\n")
            # Also write the sentinel files so find_root can locate the root,
            # though we will call check_flavor_parity with an explicit root.
            open(_os2.path.join(tmproot, "CLAUDE.md"), "w").write("")
            findings = check_flavor_parity(tmproot, _allow_set=allow_set)
            # Return only the docs-parity findings (not skill or must-match ones)
            return [f for f in findings if "docs file in" in f]
        finally:
            import shutil
            shutil.rmtree(tmproot, ignore_errors=True)

    # 8. File in claude-code but not copilot (not allow-listed) → flagged.
    rt_docs8  = {"docs/design/foo-design.md"}
    cc_docs8  = {"docs/design/foo-design.md", "docs/design/claude-only.md"}
    cp_docs8  = {"docs/design/foo-design.md"}
    f8 = _run_parity_with_docs(rt_docs8, cc_docs8, cp_docs8, allow_set=frozenset())
    # Expect at least one finding for the claude-only.md gap between claude-code and copilot
    flagged8 = any("claude-only.md" in x and "claude-code" in x and "copilot" in x for x in f8)
    cases.append(("file in claude-code but not copilot (not allow-listed) is flagged", flagged8))

    # 9. Same gap, now allow-listed → passes (no finding for that specific gap).
    allow9 = frozenset({("claude-code", "copilot", "docs/design/claude-only.md")})
    f9 = _run_parity_with_docs(rt_docs8, cc_docs8, cp_docs8, allow_set=allow9)
    still_flagged9 = any("claude-only.md" in x and "claude-code" in x and "copilot" in x for x in f9)
    cases.append(("same gap, when allow-listed, does not produce a finding", not still_flagged9))

    # 10. Release-planning archives (root-only) are never flagged, even without an explicit entry.
    rt_docs10 = {"docs/release-planning-v3.37.md", "docs/release-planning-v1.5.md"}
    cc_docs10 = set()
    cp_docs10 = set()
    f10 = _run_parity_with_docs(rt_docs10, cc_docs10, cp_docs10, allow_set=frozenset())
    flagged10 = any("release-planning" in x for x in f10)
    cases.append(("release-planning archives are never flagged as parity gaps", not flagged10))

    # ── WH-8: lean-index self-tests ─────────────────────────────────────
    import tempfile as _tmpmod

    def _run_lean_index(files_content, override_exempt=None):
        """Write README.md files into a temp tree and run a parameterized lean-index.

        Uses an inline helper so the size-exempt set can be overridden without
        module-level patching.
        """
        tmproot = _tmpmod.mkdtemp()
        try:
            for rpath, content in files_content.items():
                fpath = _os.path.join(tmproot, rpath)
                _os.makedirs(_os.path.dirname(fpath), exist_ok=True)
                open(fpath, "w").write(content)

            exempt = LEAN_INDEX_SIZE_EXEMPT if override_exempt is None else frozenset(override_exempt)
            findings = []
            for p in sorted(glob.glob(f"{tmproot}/docs/**/README.md", recursive=True)):
                rp = rel(tmproot, p)
                content = open(p).read()
                size = _os.path.getsize(p)
                links = _MD_LINK_RE.findall(content)

                if rp not in exempt and size > LEAN_INDEX_SIZE_CAP:
                    findings.append(
                        f"{rp}: index page {size} bytes > {LEAN_INDEX_SIZE_CAP} budget "
                        f"(lean-index rule)"
                    )
                if len(links) < LEAN_INDEX_MIN_LINKS:
                    findings.append(
                        f"{rp}: index page has only {len(links)} links "
                        f"(minimum {LEAN_INDEX_MIN_LINKS}, lean-index rule)"
                    )
            return findings
        finally:
            import shutil
            shutil.rmtree(tmproot, ignore_errors=True)

    # 11. Tiny README with <3 links → fails link-density rule.
    sparse_readme = "# Index\n\nNo links here.\n"
    f11 = _run_lean_index({"docs/design/README.md": sparse_readme})
    cases.append(("sparse README (<3 links) fails lean-index link-density", len(f11) >= 1))

    # 12. README with ≥3 links and ≤6KB → passes.
    dense_small_readme = (
        "# Index\n\n"
        "[Alpha](alpha.md) [Beta](beta.md) [Gamma](gamma.md)\n"
    )
    f12 = _run_lean_index({"docs/design/README.md": dense_small_readme})
    cases.append(("README with ≥3 links and ≤6KB passes lean-index", len(f12) == 0))

    # 13. Root docs/README.md (size-exempt) passes even if >6KB.
    big_root_readme = "[a](a.md) [b](b.md) [c](c.md)\n" + ("x" * 7000)
    # Use explicit exempt set containing docs/README.md to test the exemption.
    f13 = _run_lean_index(
        {"docs/README.md": big_root_readme},
        override_exempt={"docs/README.md"},
    )
    # docs/README.md is exempt from size cap → should produce 0 findings.
    cases.append(("root docs/README.md is exempt from lean-index size cap", len(f13) == 0))

    # ── WH-8: monolith-cap self-tests ───────────────────────────────────
    def _run_monolith_cap(files_content, override_exempt=None):
        """Write leaf docs into a temp tree and run a parameterized monolith-cap.

        Uses an inline helper so the exempt set can be overridden without
        module-level patching (which is fragile when the module IS this file).
        """
        tmproot = _tmpmod.mkdtemp()
        try:
            for rpath, content in files_content.items():
                fpath = _os.path.join(tmproot, rpath)
                _os.makedirs(_os.path.dirname(fpath), exist_ok=True)
                open(fpath, "w").write(content)

            exempt = MONOLITH_CAP_EXEMPT if override_exempt is None else frozenset(override_exempt)
            findings = []
            for p in sorted(glob.glob(f"{tmproot}/docs/**/*.md", recursive=True)):
                if _os.path.basename(p) == "README.md":
                    continue
                rp = rel(tmproot, p)
                if rp in exempt:
                    continue
                if _MONOLITH_CAP_RELEASE_PLAN_RE.match(rp):
                    continue
                size = _os.path.getsize(p)
                if size > MONOLITH_CAP:
                    findings.append(f"{rp}: {size} bytes > {MONOLITH_CAP} monolith cap")
            return findings
        finally:
            import shutil
            shutil.rmtree(tmproot, ignore_errors=True)

    # 14. Leaf file >20KB is flagged by monolith-cap.
    big_leaf_content = "# Big doc\n" + ("x" * 21000)
    f14 = _run_monolith_cap({"docs/design/big-design.md": big_leaf_content})
    cases.append(("leaf file >20KB is flagged by monolith-cap", len(f14) == 1))

    # 15. Same file, explicitly exempted → not flagged.
    f15 = _run_monolith_cap(
        {"docs/design/big-design.md": big_leaf_content},
        override_exempt={"docs/design/big-design.md"},
    )
    cases.append(("exempted leaf file >20KB is not flagged by monolith-cap", len(f15) == 0))

    # 16. release-planning archive (>20KB) is never flagged by monolith-cap.
    big_plan_content = "# Plan\n" + ("x" * 25000)
    f16 = _run_monolith_cap(
        {"docs/release-planning-v9.99.md": big_plan_content},
        override_exempt=set(),  # no extra exemptions — must pass via regex pattern
    )
    cases.append(("release-planning archive >20KB is never flagged by monolith-cap", len(f16) == 0))

    lines, passed, failed = [], 0, 0
    for label, ok in cases:
        lines.append(f"  {'PASS' if ok else 'FAIL'}: {label}")
        if ok:
            passed += 1
        else:
            failed += 1
    return passed, failed, lines


def main():
    args = sys.argv[1:]
    if "--self-test" in args:
        passed, failed, lines = self_test()
        for ln in lines:
            print(ln)
        print(f"\ndoc-assurance self-test: {passed} passed, {failed} failed.")
        sys.exit(1 if failed else 0)
    strict = "--strict" in args
    write = "--write-map" in args
    root = find_root(".")
    if "--root" in args:
        root = os.path.abspath(args[args.index("--root") + 1])
    named = [a for a in args if a in CHECKS] or CHECKS
    total = 0
    for c in named:
        if c == "flavor-parity":         f = check_flavor_parity(root)
        elif c == "design-layout":       f = check_design_layout(root)
        elif c == "links":               f = check_links(root)
        elif c == "docs-map":            f = check_docs_map(root, write=write)
        elif c == "release-consistency": f = check_release_consistency(root)
        elif c == "skill-budget":        f = check_skill_budget(root)
        elif c == "lean-index":          f = check_lean_index(root)
        elif c == "monolith-cap":        f = check_monolith_cap(root)
        else:                            f = []
        status = "OK" if not f else f"{len(f)} finding(s)"
        print(f"[{c}] {status}")
        for x in f:
            print(f"   - {x}")
        total += len(f)
    print(f"\ndoc-assurance: {total} finding(s) across {len(named)} check(s).")
    if strict and total:
        sys.exit(1)


if __name__ == "__main__":
    main()

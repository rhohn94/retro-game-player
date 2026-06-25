#!/usr/bin/env python3
"""grm_namespacing — deterministic, reusable transformer that namespaces every
Grimoire skill `<name>` to `grm-<name>` and rewrites every reference.

This is the *migrate engine* for the GN epic (v3.42):
  * GN-1 renames the framework's own skills (run against this repo).
  * GN-3's consumer migrate row invokes the SAME logic against a managed
    project's `.claude/skills/` tree, so the rules here are the contract.

The transformer is stdlib-only and idempotent. It implements two reference
rewrite tiers (see the design doc, grm-namespacing-design.md):

  Tier 1 — PATH references (aggressive, unambiguous):
      every `skills/<name>/` -> `skills/grm-<name>/` for each KNOWN skill name,
      across all text files. This covers `.claude/skills/<name>/`,
      golden `skills/<name>/`, `copilot/.claude/skills/<name>/`, and relative
      forms — they all share the `skills/<name>/` substring.

  Tier 2 — bare-name prose (conservative, to avoid corrupting common-word
      skill names like `grm-iterate`, `grm-scout`, `grm-reviewer`):
      (a) a backticked token EXACTLY equal to a known name: `<name>` -> `grm-<name>`
      (b) `<name> skill` / `skill <name>` / `the <name> skill` patterns.

Directory renames preserve git history via `git mv` (falling back to os.rename
when the path is untracked / not in a repo).

Post-sync collision handling: a consumer that ran `grm-sync-from-upstream`
already received the new `grm-<name>/` skill (added non-destructively by the
file-walk) while the old bare-named `<name>/` still sits beside it. In that
state the synced `grm-<name>/` is authoritative, so this transformer ARCHIVES
the stale bare-named dir to `.grimoire-archive/grm-namespacing-<ts>/` and then
REMOVES it — it never `git mv`s onto the existing dir (which would nest it as
`grm-<name>/<name>/`). This is what completes the cutover for an already-synced
project.

Usage:
    python3 grm_namespacing.py --root <repo-root> [--apply] [--dry-run]
    python3 grm_namespacing.py --self-test

Default mode is --dry-run (report only). Pass --apply to mutate the tree.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

PREFIX = "grm-"

# Directories never touched (anywhere in the tree).
EXCLUDED_DIR_NAMES = {".git", ".grimoire-archive", "dist", "node_modules", "__pycache__"}

# File suffixes treated as rewritable text.
TEXT_SUFFIXES = {".md", ".py", ".sh", ".json", ".toml", ".txt", ".yml", ".yaml", ".js"}
# Extensionless text files we still rewrite (agent defs, config stubs, CLAUDE/AGENTS).
TEXT_NAMES = {"CLAUDE.md", "AGENTS.md"}


@dataclass
class TransformReport:
    """Accumulates what the transformer did (or would do in dry-run)."""

    dirs_renamed: list[tuple[str, str]] = field(default_factory=list)
    # Stale bare-named dirs archived+removed because grm-<name>/ already existed
    # (the post-sync collision case): (old_rel, existing_grm_rel).
    dirs_removed: list[tuple[str, str]] = field(default_factory=list)
    frontmatter_updated: list[str] = field(default_factory=list)
    files_rewritten: dict[str, int] = field(default_factory=dict)  # path -> edit count

    def merge(self, other: "TransformReport") -> None:
        self.dirs_renamed.extend(other.dirs_renamed)
        self.dirs_removed.extend(other.dirs_removed)
        self.frontmatter_updated.extend(other.frontmatter_updated)
        for k, v in other.files_rewritten.items():
            self.files_rewritten[k] = self.files_rewritten.get(k, 0) + v

    def summary(self) -> str:
        return (
            f"dirs_renamed={len(self.dirs_renamed)} "
            f"dirs_removed={len(self.dirs_removed)} "
            f"frontmatter_updated={len(self.frontmatter_updated)} "
            f"files_rewritten={len(self.files_rewritten)} "
            f"total_edits={sum(self.files_rewritten.values())}"
        )


class GrmNamespacer:
    """Applies the grm- namespacing rules to a repository tree.

    Construct with a root path, call discover_skill_names() to enumerate the
    known skill set programmatically, then run() to apply (or preview) the
    transform. The instance is reusable across roots via a fresh construction.
    """

    def __init__(self, root: Path, apply: bool = False) -> None:
        self.root = Path(root).resolve()
        self.apply = apply
        self.names: list[str] = []
        self.report = TransformReport()
        # One archive root per run; created lazily on first archived dir.
        self.archive_root = (
            self.root / ".grimoire-archive" / f"grm-namespacing-{datetime.now():%Y%m%d-%H%M%S}"
        )

    # -- discovery ---------------------------------------------------------

    def _skills_parents(self) -> list[Path]:
        """Every directory literally named `skills` under root (excluding the
        excluded dirs), i.e. the flavor `.claude/skills` trees AND every
        `workflow-bootstrap/golden/skills` tree."""
        parents: list[Path] = []
        for dirpath, dirnames, _ in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIR_NAMES]
            for d in dirnames:
                if d == "skills":
                    parents.append(Path(dirpath) / d)
        return sorted(parents)

    def discover_skill_names(self) -> list[str]:
        """Programmatically enumerate skill names: any immediate child dir of a
        `skills/` parent that contains a SKILL.md (or any file) and is not
        already grm-prefixed. The union across all skills parents is the known
        set."""
        names: set[str] = set()
        for parent in self._skills_parents():
            for child in parent.iterdir():
                if not child.is_dir():
                    continue
                if child.name in EXCLUDED_DIR_NAMES:
                    continue
                # golden/worktrees subdirs of a skill are not skills themselves;
                # a skill dir is a direct child of a `skills/` dir.
                base = child.name[len(PREFIX):] if child.name.startswith(PREFIX) else child.name
                names.add(base)
        self.names = sorted(names)
        return self.names

    # -- directory rename --------------------------------------------------

    def _git_mv(self, src: Path, dst: Path) -> None:
        """Rename preserving git history when possible."""
        if not self.apply:
            return
        try:
            subprocess.run(
                ["git", "-C", str(self.root), "mv", str(src), str(dst)],
                check=True,
                capture_output=True,
                text=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            # Untracked path or no git — plain rename; git detects on add.
            os.rename(src, dst)

    def _archive_dir(self, src: Path) -> None:
        """Copy src into this run's archive root, preserving its repo-relative
        path, so a removed original stays recoverable. No-op in dry-run."""
        if not self.apply:
            return
        dest = self.archive_root / src.relative_to(self.root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dest)

    def _git_rm(self, path: Path) -> None:
        """Remove a directory, preferring `git rm` so the deletion is staged."""
        if not self.apply:
            return
        try:
            subprocess.run(
                ["git", "-C", str(self.root), "rm", "-r", "-q", "--", str(path)],
                check=True,
                capture_output=True,
                text=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            # Untracked path or no git — plain recursive delete.
            shutil.rmtree(path)

    def rename_dirs(self) -> None:
        # Deepest-first: a `skills/` parent may be NESTED under another skill
        # dir (e.g. workflow-bootstrap/golden/skills lives under the
        # grm-workflow-bootstrap skill). Renaming the outer skill first would
        # invalidate the inner parent's path mid-loop. Process by descending
        # path depth so inner parents are renamed before their containing dir.
        parents = sorted(
            self._skills_parents(),
            key=lambda p: len(p.relative_to(self.root).parts),
            reverse=True,
        )
        for parent in parents:
            if not parent.is_dir():
                continue  # an ancestor was already renamed (defensive)
            for child in sorted(parent.iterdir()):
                if not child.is_dir():
                    continue
                if child.name in EXCLUDED_DIR_NAMES:
                    continue
                if child.name.startswith(PREFIX):
                    continue  # idempotent: already namespaced
                if child.name not in self.names:
                    continue
                dst = parent / (PREFIX + child.name)
                src_rel = str(child.relative_to(self.root))
                dst_rel = str(dst.relative_to(self.root))
                if dst.exists():
                    # Post-sync collision: the grm-<name>/ skill is already
                    # installed and authoritative. Archive the stale bare-named
                    # duplicate and remove it — a blind `git mv` here would nest
                    # it as grm-<name>/<name>/ (exit 0, silently wrong).
                    self._archive_dir(child)
                    self._git_rm(child)
                    self.report.dirs_removed.append((src_rel, dst_rel))
                else:
                    self._git_mv(child, dst)
                    self.report.dirs_renamed.append((src_rel, dst_rel))

    # -- frontmatter -------------------------------------------------------

    _FM_NAME_RE = re.compile(r"^(name:\s*)([A-Za-z0-9_-]+)\s*$", re.MULTILINE)

    def update_frontmatter(self) -> None:
        """In each renamed SKILL.md set frontmatter name: to grm-<dir>."""
        for parent in self._skills_parents():
            for child in sorted(parent.iterdir()):
                if not child.is_dir() or not child.name.startswith(PREFIX):
                    continue
                skill_md = child / "SKILL.md"
                if not skill_md.exists():
                    continue
                expected = child.name  # already grm-prefixed dir name
                text = skill_md.read_text(encoding="utf-8")
                # Only touch the name: line inside the leading frontmatter block.
                if not text.startswith("---"):
                    continue
                end = text.find("\n---", 3)
                if end == -1:
                    continue
                head, body = text[: end + 4], text[end + 4 :]

                def _sub(m: re.Match) -> str:
                    return f"{m.group(1)}{expected}"

                new_head, n = self._FM_NAME_RE.subn(_sub, head, count=1)
                if n and new_head != head:
                    rel = str(skill_md.relative_to(self.root))
                    if self.apply:
                        skill_md.write_text(new_head + body, encoding="utf-8")
                    self.report.frontmatter_updated.append(rel)

    # -- reference rewriting ----------------------------------------------

    def _build_patterns(self) -> tuple[re.Pattern, re.Pattern, re.Pattern, re.Pattern]:
        # Sort longest-first so e.g. `grm-release-phase-merge` matches before
        # `grm-release-phase`.
        ordered = sorted(self.names, key=len, reverse=True)
        alt = "|".join(re.escape(n) for n in ordered)
        # Tier 1: skills/<name>/  -> skills/grm-<name>/   (only when not already grm-)
        path_re = re.compile(rf"(skills/)(?!grm-)({alt})(/)")
        # Tier 2a: backticked exact token `<name>` (not already grm-)
        backtick_re = re.compile(rf"`(?!grm-)({alt})`")
        # Tier 2b: "<name> skill" / "the <name> skill" / "skill <name>"
        name_skill_re = re.compile(rf"(?<![\w-])(?!grm-)({alt})(\s+skill\b)")
        skill_name_re = re.compile(rf"(\bskill\s+)(?!grm-)({alt})(?![\w-])")
        return path_re, backtick_re, name_skill_re, skill_name_re

    def _iter_text_files(self) -> Iterable[Path]:
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIR_NAMES]
            for fn in filenames:
                p = Path(dirpath) / fn
                if p.suffix in TEXT_SUFFIXES or fn in TEXT_NAMES:
                    yield p

    def rewrite_references(self) -> None:
        path_re, backtick_re, name_skill_re, skill_name_re = self._build_patterns()
        for p in self._iter_text_files():
            try:
                text = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            new = text
            count = 0
            new, n = path_re.subn(lambda m: f"{m.group(1)}{PREFIX}{m.group(2)}{m.group(3)}", new)
            count += n
            new, n = backtick_re.subn(lambda m: f"`{PREFIX}{m.group(1)}`", new)
            count += n
            new, n = name_skill_re.subn(lambda m: f"{PREFIX}{m.group(1)}{m.group(2)}", new)
            count += n
            new, n = skill_name_re.subn(lambda m: f"{m.group(1)}{PREFIX}{m.group(2)}", new)
            count += n
            if count and new != text:
                rel = str(p.relative_to(self.root))
                self.report.files_rewritten[rel] = count
                if self.apply:
                    p.write_text(new, encoding="utf-8")

    # -- orchestration -----------------------------------------------------

    def run(self) -> TransformReport:
        self.discover_skill_names()
        # Order matters: rename dirs first so frontmatter/paths resolve against
        # the new layout, then update frontmatter, then rewrite references
        # (references are rewritten by name substring so order vs. rename is
        # immaterial, but doing it last keeps the report coherent).
        self.rename_dirs()
        self.update_frontmatter()
        self.rewrite_references()
        return self.report


# -- self-test -------------------------------------------------------------


def _self_test() -> int:
    """Seed a fake skill + referencing file in a tempdir, run, assert the
    contract: dir renamed, path rewritten, common-word false-positive avoided."""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        # Fake skill `grm-scout` (a common-word name) + a normal skill `grm-doc-assurance`.
        (root / ".claude" / "skills" / "scout").mkdir(parents=True)
        (root / ".claude" / "skills" / "doc-assurance").mkdir(parents=True)
        (root / ".claude" / "skills" / "scout" / "SKILL.md").write_text(
            "---\nname: scout\ndescription: x\n---\n# scout\n", encoding="utf-8"
        )
        (root / ".claude" / "skills" / "doc-assurance" / "SKILL.md").write_text(
            "---\nname: doc-assurance\n---\n", encoding="utf-8"
        )
        # Post-sync COLLISION: a sync already added grm-iterate/ (authoritative,
        # NEW content) while the stale bare-named iterate/ (OLD content) remains.
        (root / ".claude" / "skills" / "iterate").mkdir(parents=True)
        (root / ".claude" / "skills" / "iterate" / "SKILL.md").write_text(
            "---\nname: iterate\n---\nOLD-stale-content\n", encoding="utf-8"
        )
        (root / ".claude" / "skills" / "grm-iterate").mkdir(parents=True)
        (root / ".claude" / "skills" / "grm-iterate" / "SKILL.md").write_text(
            "---\nname: grm-iterate\n---\nNEW-synced-content\n", encoding="utf-8"
        )
        # A referencing doc: a real path, a backticked name, a prose pattern,
        # AND a common-word false-positive ("scout the area" — must NOT rewrite).
        ref = root / "docs" / "guide.md"
        ref.parent.mkdir(parents=True)
        ref.write_text(
            "Run `python3 .claude/skills/grm-scout/scout.py`.\n"
            "Use the `grm-scout` skill and the grm-doc-assurance skill.\n"
            "We scout the area before we iterate on the plan.\n"
            "See skills/grm-doc-assurance/SKILL.md too.\n",
            encoding="utf-8",
        )

        ns = GrmNamespacer(root, apply=True)
        report = ns.run()

        # 1. dir renamed
        if not (root / ".claude" / "skills" / "grm-scout").is_dir():
            failures.append("grm-scout dir not created")
        if (root / ".claude" / "skills" / "scout").exists():
            failures.append("old scout dir still present")

        # 2. frontmatter updated
        fm = (root / ".claude" / "skills" / "grm-scout" / "SKILL.md").read_text()
        if "name: grm-scout" not in fm:
            failures.append("frontmatter name not updated")

        # 3. path rewrite (Tier 1)
        out = ref.read_text()
        if "skills/grm-scout/scout.py" not in out:
            failures.append("Tier-1 path rewrite failed (.claude/skills/grm-scout/)")
        if "skills/grm-doc-assurance/SKILL.md" not in out:
            failures.append("Tier-1 relative path rewrite failed")

        # 4. backticked exact token (Tier 2a)
        if "`grm-scout` skill" not in out:
            failures.append("Tier-2a backtick rewrite failed")

        # 5. prose pattern (Tier 2b) — "the grm-doc-assurance skill"
        if "grm-doc-assurance skill" not in out:
            failures.append("Tier-2b prose rewrite failed")

        # 6. CONSERVATIVE: un-backticked common word NOT rewritten
        if "We scout the area" not in out:
            failures.append("FALSE POSITIVE: bare 'scout' verb was mangled")
        if "iterate on the plan" not in out:
            failures.append("FALSE POSITIVE: bare 'iterate' verb was mangled")

        # 7. POST-SYNC COLLISION: stale iterate/ removed (not nested), synced
        #    grm-iterate/ content preserved, original archived, reported.
        skills = root / ".claude" / "skills"
        if (skills / "iterate").exists():
            failures.append("COLLISION: stale bare-named iterate/ not removed")
        if (skills / "grm-iterate" / "iterate").exists():
            failures.append("COLLISION: nested grm-iterate/iterate/ created (the bug)")
        gi = (skills / "grm-iterate" / "SKILL.md").read_text()
        if "NEW-synced-content" not in gi:
            failures.append("COLLISION: synced grm-iterate/ content was clobbered")
        archived = list(root.glob(".grimoire-archive/*/.claude/skills/iterate/SKILL.md"))
        if not archived:
            failures.append("COLLISION: stale iterate/ was not archived")
        elif "OLD-stale-content" not in archived[0].read_text():
            failures.append("COLLISION: archive does not hold the original content")
        if not any(src.endswith("skills/iterate") for src, _ in report.dirs_removed):
            failures.append("COLLISION: dirs_removed did not record the stale dir")

        # 8. idempotency: a second run is a no-op
        ns2 = GrmNamespacer(root, apply=True)
        rep2 = ns2.run()
        if (
            rep2.dirs_renamed
            or rep2.dirs_removed
            or rep2.frontmatter_updated
            or rep2.files_rewritten
        ):
            failures.append(f"NOT IDEMPOTENT: second run changed things: {rep2.summary()}")

    if failures:
        print("SELF-TEST FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SELF-TEST PASSED")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="grm- skill namespacing transformer")
    ap.add_argument("--root", default=".", help="repository root to transform")
    ap.add_argument("--apply", action="store_true", help="mutate the tree (default: dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="report only (default)")
    ap.add_argument("--self-test", action="store_true", help="run the built-in fixture test")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    apply = args.apply and not args.dry_run
    ns = GrmNamespacer(Path(args.root), apply=apply)
    report = ns.run()
    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] known skills: {len(ns.names)}")
    print(f"[{mode}] {report.summary()}")
    for src, dst in report.dirs_renamed:
        print(f"  rename: {src} -> {dst}")
    for src, dst in report.dirs_removed:
        print(f"  remove-stale: {src} (kept {dst}; archived)")
    for rel in sorted(report.frontmatter_updated):
        print(f"  frontmatter: {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

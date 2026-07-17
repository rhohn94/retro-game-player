#!/usr/bin/env python3
"""Aura conformance checker for reimplementations.

A downstream reimplementation of Aura (e.g. a native or Rust port) must render
the same concrete token values as the reference engine. This tool diffs a
candidate's resolved values against the golden snapshot (`tokens.resolved.json`)
and reports drift, with a small tolerance for engine last-digit differences in
colors.

    python3 tools/aura_conformance.py candidate.json
    python3 tools/aura_conformance.py candidate.json --tolerance 3

`candidate.json` is a flat JSON map of token name -> resolved value. Keys may be
bare (`bg`) or prefixed (`--aura-bg`); both are accepted. Exit status is 0 when
the candidate conforms, 1 when there is drift, 2 on usage/IO error.

Dependency-free (Python stdlib only). See docs/design/consumer-tooling-design.md.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from aura_tokens import DEFAULT_SNAPSHOT, load_tokens  # sibling module

#: default per-channel colour tolerance (0-255) absorbing engine rounding
DEFAULT_TOLERANCE = 2
#: alpha tolerance (0-1)
ALPHA_TOLERANCE = 0.02


class Color:
    """An sRGB colour parsed from a CSS-ish string into 0-255 channels + alpha.

    Understands `rgb()/rgba()`, `color(srgb r g b / a)` (0-1 floats), and
    `#rgb/#rrggbb/#rrggbbaa`. `parse` returns None for anything it cannot read,
    so the comparator can fall back to a string match."""

    def __init__(self, r, g, b, a=1.0):
        self.r, self.g, self.b, self.a = r, g, b, a

    @classmethod
    def parse(cls, text):
        if not isinstance(text, str):
            return None
        s = text.strip().lower()
        m = re.fullmatch(r"rgba?\(([^)]+)\)", s)
        if m:
            parts = re.split(r"[,/]", m.group(1))
            nums = [p.strip() for p in parts if p.strip() != ""]
            try:
                r, g, b = (int(round(float(nums[i]))) for i in range(3))
                a = float(nums[3]) if len(nums) > 3 else 1.0
                return cls(r, g, b, a)
            except (ValueError, IndexError):
                return None
        m = re.fullmatch(r"color\(srgb\s+([^)]+)\)", s)
        if m:
            body = m.group(1).replace("/", " ")
            nums = [p for p in body.split() if p]
            try:
                r, g, b = (int(round(float(nums[i]) * 255)) for i in range(3))
                a = float(nums[3]) if len(nums) > 3 else 1.0
                return cls(r, g, b, a)
            except (ValueError, IndexError):
                return None
        m = re.fullmatch(r"#([0-9a-f]{3,8})", s)
        if m:
            h = m.group(1)
            if len(h) in (3, 4):
                h = "".join(c * 2 for c in h)
            try:
                r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
                a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
                return cls(r, g, b, a)
            except ValueError:
                return None
        return None

    def close_to(self, other, tol, alpha_tol=ALPHA_TOLERANCE):
        return (abs(self.r - other.r) <= tol and abs(self.g - other.g) <= tol
                and abs(self.b - other.b) <= tol and abs(self.a - other.a) <= alpha_tol)


def normalize_key(key):
    """Strip an optional `--aura-` or `--` prefix from a candidate key."""
    if key.startswith("--aura-"):
        return key[len("--aura-"):]
    if key.startswith("--"):
        return key[2:]
    return key


def normalize_value(text):
    """Collapse whitespace for non-colour string comparison."""
    return re.sub(r"\s+", " ", str(text)).strip()


class Comparator:
    """Compares a candidate token map against the golden pairs; accumulates
    missing / mismatched / extra findings."""

    def __init__(self, golden_pairs, tolerance=DEFAULT_TOLERANCE):
        self.golden = dict(golden_pairs)
        self.tolerance = tolerance
        self.missing = []
        self.mismatched = []   # (name, expected, got)
        self.extra = []

    def run(self, candidate):
        cand = {normalize_key(k): v for k, v in candidate.items()}
        for name, expected in self.golden.items():
            if name not in cand:
                self.missing.append(name)
                continue
            got = cand[name]
            if not self._values_match(expected, got):
                self.mismatched.append((name, expected, got))
        for name in cand:
            if name not in self.golden:
                self.extra.append(name)
        return self

    def _values_match(self, expected, got):
        ec, gc = Color.parse(expected), Color.parse(got)
        if ec and gc:
            return ec.close_to(gc, self.tolerance)
        return normalize_value(expected) == normalize_value(got)

    @property
    def conforms(self):
        return not self.missing and not self.mismatched

    def report(self):
        lines = []
        if self.mismatched:
            lines.append("MISMATCH (%d):" % len(self.mismatched))
            for name, exp, got in self.mismatched:
                lines.append("  --aura-%s: expected %r, got %r" % (name, exp, got))
        if self.missing:
            lines.append("MISSING (%d): %s" % (len(self.missing), ", ".join(self.missing)))
        if self.extra:
            lines.append("EXTRA (%d, ignored): %s" % (len(self.extra), ", ".join(self.extra)))
        if self.conforms:
            lines.append("CONFORMS — %d tokens match within tolerance %d."
                         % (len(self.golden), self.tolerance))
        return "\n".join(lines)


def check(candidate_path, snapshot_path=DEFAULT_SNAPSHOT, tolerance=DEFAULT_TOLERANCE):
    """Load both sides and return a finished Comparator."""
    candidate = json.loads(Path(candidate_path).read_text())
    if not isinstance(candidate, dict):
        raise ValueError("candidate must be a JSON object of name -> value")
    golden = load_tokens(snapshot_path)
    return Comparator(golden, tolerance).run(candidate)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check a reimplementation's tokens against Aura's golden snapshot.")
    parser.add_argument("candidate", help="flat JSON map of token name -> resolved value")
    parser.add_argument("--snapshot", "-s", default=str(DEFAULT_SNAPSHOT))
    parser.add_argument("--tolerance", "-t", type=int, default=DEFAULT_TOLERANCE,
                        help="per-channel colour tolerance, 0-255 (default %d)" % DEFAULT_TOLERANCE)
    args = parser.parse_args(argv)
    try:
        cmp = check(args.candidate, args.snapshot, args.tolerance)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("aura_conformance: error: %s" % exc, file=sys.stderr)
        return 2
    print(cmp.report())
    return 0 if cmp.conforms else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""code_health.py — module-coupling section of the grm-code-health report (#212).

Closes the gap named in issue #212: `grm-code-health`'s SKILL.md describes a
module-coupling metric that "reuses the same scan grm-architecture-audit
uses" — but no script existed to actually run it, so every invocation
re-derived the import graph via agent prose. This script imports the shared
`architecture_fitness` engine (`.claude/skills/grm-architecture-audit/`)
for that one section instead of a second implementation.

Scope (deliberately tight — see #212 discussion): this script owns ONLY
Section B's module-coupling metrics (Ca/Ce/instability per layer, from the
shared import-graph scan) plus the `.claude/cache/code-health-baseline.json`
read/diff/write cycle for that metric. Dead-code/duplication (Section A) and
the complexity-tool wrappers (radon/ts-complexity/gocyclo) remain the agent's
job per the existing SKILL.md prose — building vulture/ts-prune/radon/gocyclo
wrappers is explicitly out of scope for this pass.

Usage:
    code_health.py --root DIR [--rules PATH] [--baseline PATH] [--accept] [--json]
    code_health.py --self-test

Exit codes:
    0  always for a plain report (this section never gates on its own —
       grm-code-health's own --gate composes this with Section A per the
       v1.26 code-quality dials, which this script does not own)
    1  --self-test failed, or the rules file is present but malformed
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "grm-architecture-audit"))
import architecture_fitness as af  # noqa: E402  (path set above)

BASELINE_REL_PATH = ".claude/cache/code-health-baseline.json"


def compute_coupling_report(root: str, rules_path: str = None) -> dict:
    """Return {"rules_declared": bool, "coupling": {layer: {...}}}. Mirrors
    architecture_fitness's own graceful-degradation contract: an absent
    architecture-rules.json yields an empty, rules_declared=False report
    rather than an error (module coupling is opt-in the same way the
    architecture audit is)."""
    rules_path = rules_path or os.path.join(root, af.RULES_REL_PATH)
    rules = af.load_rules(rules_path)
    if rules is None:
        return {"rules_declared": False, "coupling": {}}
    edges = af.build_import_graph(root, rules)
    return {"rules_declared": True, "coupling": af.module_coupling(edges)}


def load_baseline(path: str) -> dict:
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}
    return data.get("coupling", {}) if isinstance(data, dict) else {}


def write_baseline(path: str, coupling: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"coupling": coupling}, fh, indent=2, sort_keys=True)
    os.replace(tmp, path)


def diff_coupling(current: dict, baseline: dict) -> dict:
    """Per-layer delta vs baseline: {layer: {"Ca": d, "Ce": d, "instability": d}}.
    A layer present only in one side reports the other side as 0 (new/removed
    layer), never raising a KeyError."""
    deltas = {}
    for layer in sorted(set(current) | set(baseline)):
        cur = current.get(layer, {"Ca": 0, "Ce": 0, "instability": 0.0})
        base = baseline.get(layer, {"Ca": 0, "Ce": 0, "instability": 0.0})
        deltas[layer] = {
            "Ca": cur["Ca"] - base["Ca"],
            "Ce": cur["Ce"] - base["Ce"],
            "instability": round(cur["instability"] - base["instability"], 3),
        }
    return deltas


def run(root: str, rules_path=None, baseline_path=None, accept: bool = False,
        as_json: bool = False) -> int:
    try:
        report = compute_coupling_report(root, rules_path)
    except ValueError as e:
        print(f"code-health: ERROR: {e}")
        return 1

    baseline_path = baseline_path or os.path.join(root, BASELINE_REL_PATH)

    if not report["rules_declared"]:
        msg = "code-health: no architecture rules declared — module-coupling section skipped"
        print(json.dumps({"rules_declared": False}) if as_json else msg)
        return 0

    coupling = report["coupling"]
    baseline = load_baseline(baseline_path)
    deltas = diff_coupling(coupling, baseline)

    if accept:
        write_baseline(baseline_path, coupling)

    if as_json:
        print(json.dumps({
            "rules_declared": True,
            "coupling": coupling,
            "baseline": baseline,
            "delta": deltas,
            "baseline_written": accept,
        }, indent=2, sort_keys=True))
    else:
        print("code-health — Section B (module coupling, shared architecture-audit scan):")
        for layer in sorted(coupling):
            c = coupling[layer]
            d = deltas[layer]
            print(f"  {layer:24s} Ca={c['Ca']:<4d} Ce={c['Ce']:<4d} "
                  f"I={c['instability']:.3f}  "
                  f"(delta Ca={d['Ca']:+d} Ce={d['Ce']:+d} I={d['instability']:+.3f})")
        if accept:
            print(f"baseline written: {baseline_path}")
    return 0


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------


def _write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def self_test() -> int:
    import tempfile

    passed, failed = 0, 0
    lines = []

    def check(label, ok):
        nonlocal passed, failed
        lines.append(f"  {'PASS' if ok else 'FAIL'}: {label}")
        if ok:
            passed += 1
        else:
            failed += 1

    # 1. Absent rules file -> rules_declared False, exit 0, no baseline written.
    with tempfile.TemporaryDirectory() as tmp:
        rc = run(tmp)
        check("absent rules file exits 0 (no architecture rules declared)", rc == 0)
        check("no baseline written when rules absent",
              not os.path.isfile(os.path.join(tmp, BASELINE_REL_PATH)))

    # 2. Fixture project with resolvable cross-layer imports.
    with tempfile.TemporaryDirectory() as tmp:
        _write(os.path.join(tmp, "src/ui/cart.py"),
                  "from src.services.checkout import total\n")
        _write(os.path.join(tmp, "src/services/checkout.py"), "import os\n")
        rules = {
            "schema-version": 1,
            "layers": {
                "presentation": ["src/ui/**"],
                "application": ["src/services/**"],
            },
            "allowed-edges": [["presentation", "application"]],
        }
        _write(os.path.join(tmp, af.RULES_REL_PATH), json.dumps(rules))

        report = compute_coupling_report(tmp)
        check("coupling report declares rules", report["rules_declared"] is True)
        check("presentation shows efferent coupling (Ce>=1)",
              report["coupling"]["presentation"]["Ce"] >= 1)
        check("application shows afferent coupling (Ca>=1)",
              report["coupling"]["application"]["Ca"] >= 1)

        baseline_path = os.path.join(tmp, BASELINE_REL_PATH)
        rc = run(tmp, accept=True)
        check("run(accept=True) exits 0", rc == 0)
        check("baseline file written", os.path.isfile(baseline_path))

        baseline = load_baseline(baseline_path)
        check("baseline round-trips the coupling numbers",
              baseline == report["coupling"])

        # No source change -> delta vs freshly-written baseline is all zero.
        report2 = compute_coupling_report(tmp)
        deltas = diff_coupling(report2["coupling"], baseline)
        check("delta vs freshly-accepted baseline is zero",
              all(d["Ca"] == 0 and d["Ce"] == 0 and d["instability"] == 0.0
                  for d in deltas.values()))

        # Add a new cross-layer import and confirm the delta moves.
        _write(os.path.join(tmp, "src/ui/checkout_page.py"),
                  "from src.services.checkout import total\n")
        report3 = compute_coupling_report(tmp)
        deltas3 = diff_coupling(report3["coupling"], baseline)
        check("delta reflects a newly added cross-layer import",
              deltas3["application"]["Ca"] > 0)

    # 3. diff_coupling handles a layer present only on one side.
    d = diff_coupling({"a": {"Ca": 2, "Ce": 1, "instability": 0.5}}, {})
    check("diff_coupling handles a layer new since baseline (no KeyError)",
          d["a"]["Ca"] == 2)
    d2 = diff_coupling({}, {"b": {"Ca": 3, "Ce": 0, "instability": 0.0}})
    check("diff_coupling handles a layer removed since baseline",
          d2["b"]["Ca"] == -3)

    # 4. Malformed rules file surfaces as an error, not a silent pass.
    with tempfile.TemporaryDirectory() as tmp:
        _write(os.path.join(tmp, af.RULES_REL_PATH), "{not json")
        rc = run(tmp)
        check("malformed rules file exits 1", rc == 1)

    print(f"code-health self-test: {passed} passed, {failed} failed.")
    for ln in lines:
        print(ln)
    return 1 if failed else 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="grm-code-health Section B module-coupling metrics, sharing "
                    "the architecture_fitness import-graph scan (#212)."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-test", action="store_true",
                       help="Run against built-in offline fixtures (no network calls).")
    mode.add_argument("--root", metavar="DIR", help="Repo root to scan.")
    parser.add_argument("--rules", metavar="PATH",
                         help="Override path to architecture-rules.json.")
    parser.add_argument("--baseline", metavar="PATH",
                         help="Override path to code-health-baseline.json "
                              f"(default: <root>/{BASELINE_REL_PATH}).")
    parser.add_argument("--accept", action="store_true",
                         help="Write the current coupling numbers as the new baseline.")
    parser.add_argument("--json", action="store_true",
                         help="Emit the report as JSON instead of the human table.")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    return run(args.root, rules_path=args.rules, baseline_path=args.baseline,
               accept=args.accept, as_json=args.json)


if __name__ == "__main__":
    sys.exit(main())

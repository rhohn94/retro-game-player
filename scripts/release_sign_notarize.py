#!/usr/bin/env python3
"""release_sign_notarize.py — Developer-ID sign, notarize, staple, and verify
the macOS release DMG (W300 "Passport").

Wraps `pnpm tauri build` with the Developer-ID signing + Apple notarization +
stapling + Gatekeeper-verification chain described in
docs/design/notarization-distribution-design.md. Every step past the base
build is **individually conditional** on the credentials it needs being
present in the environment, and logs a clear reason when it is skipped — so
the existing unsigned-DMG build path keeps working end to end with zero
credentials configured (this sandboxed environment and any CI-less local dev
machine).

Environment variables (all optional; see design doc §1/§5):
  RGP_SIGNING_IDENTITY  Keychain identity string for `codesign --sign` /
                        Tauri's `APPLE_SIGNING_IDENTITY`. Absent => build
                        stays unsigned; every later step is skipped.
  RGP_APPLE_TEAM_ID     Apple Developer Team ID. Informational; forwarded to
                        the environment for tooling that reads it.
  RGP_NOTARY_PROFILE    `notarytool` keychain-profile name created via
                        `xcrun notarytool store-credentials`. Absent =>
                        notarization + stapling are skipped, independent of
                        whether signing ran.

Modes:
  (default)     Build (+ sign/notarize/staple/verify as configured).
  --self-test   Deterministic, stdlib-only regression run of the command-
                construction + skip-logic (no network, no real codesign/
                notarytool invocation). Mirrors the sync_deps.py convention.
  --skip-build  Reuse the existing bundle output instead of rebuilding
                (useful for iterating on this script itself).

stdlib-only — no third-party dependencies, matching the project's other
`scripts/*.py` tooling.
"""

from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_TAURI_DIR = REPO_ROOT / "src-tauri"
DMG_GLOB = str(SRC_TAURI_DIR / "target" / "release" / "bundle" / "dmg" / "*.dmg")
APP_GLOB = str(SRC_TAURI_DIR / "target" / "release" / "bundle" / "macos" / "*.app")

# Gatekeeper's own acceptance check — the exact invocation macOS runs when a
# user opens a downloaded DMG. See design doc §6.
SPCTL_CONTEXT = "context:primary-signature"


class ReleaseSigningError(RuntimeError):
    """Raised when a step that WAS attempted (credentials present) fails."""


@dataclass(frozen=True)
class SigningConfig:
    """Sources Developer-ID signing + notarization config from the
    environment. No value is ever hardcoded or read from a committed file —
    see docs/design/notarization-distribution-design.md §1/§5."""

    signing_identity: str | None
    apple_team_id: str | None
    notary_profile: str | None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "SigningConfig":
        env = os.environ if env is None else env
        return cls(
            signing_identity=env.get("RGP_SIGNING_IDENTITY") or None,
            apple_team_id=env.get("RGP_APPLE_TEAM_ID") or None,
            notary_profile=env.get("RGP_NOTARY_PROFILE") or None,
        )

    @property
    def can_sign(self) -> bool:
        return self.signing_identity is not None

    @property
    def can_notarize(self) -> bool:
        # Notarization needs a signed, hardened-runtime binary to submit.
        return self.can_sign and self.notary_profile is not None


class CommandRunner:
    """Thin subprocess wrapper so every external call is logged the same way
    and is trivially mockable/self-testable without shelling out for real."""

    def __init__(self, *, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.invocations: list[list[str]] = []

    def run(self, args: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
        self.invocations.append(args)
        print(f"[release] $ {' '.join(args)}", file=sys.stderr)
        if self.dry_run:
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        return subprocess.run(args, check=check, capture_output=True, text=True)


class TauriBuildStep:
    """Runs `pnpm tauri build`, forwarding Developer-ID signing env vars
    into Tauri's own recognized variable names only when a signing identity
    is configured (design doc §1)."""

    def __init__(self, config: SigningConfig, runner: CommandRunner) -> None:
        self.config = config
        self.runner = runner

    def build_env(self) -> dict[str, str]:
        env = dict(os.environ)
        if self.config.can_sign:
            env["APPLE_SIGNING_IDENTITY"] = self.config.signing_identity  # type: ignore[assignment]
            print(
                "[release] Developer-ID signing identity configured — "
                "hardened-runtime signed build.",
                file=sys.stderr,
            )
        else:
            print(
                "[release] RGP_SIGNING_IDENTITY not set — building unsigned "
                "(ad-hoc) DMG, same as `pnpm tauri build` today.",
                file=sys.stderr,
            )
        return env

    def run(self) -> None:
        env = self.build_env()
        result = subprocess.run(
            ["pnpm", "tauri", "build"], cwd=REPO_ROOT, env=env, check=False
        )
        if result.returncode != 0:
            raise ReleaseSigningError(f"pnpm tauri build failed (exit {result.returncode})")


class CodesignVerifyStep:
    """Verifies the built .app's signature. Skipped (not failed) when the
    build was never signed in the first place."""

    def __init__(self, config: SigningConfig, runner: CommandRunner) -> None:
        self.config = config
        self.runner = runner

    def run(self, app_path: str | None) -> None:
        if not self.config.can_sign:
            print(
                "[release] skip codesign --verify: no signing identity configured.",
                file=sys.stderr,
            )
            return
        if app_path is None:
            raise ReleaseSigningError(
                "signing identity configured but no built .app was found to verify"
            )
        result = self.runner.run(
            ["codesign", "--verify", "--deep", "--strict", "--verbose=2", app_path],
            check=False,
        )
        if result.returncode != 0:
            raise ReleaseSigningError(
                f"codesign --verify failed for {app_path}: {result.stderr}"
            )
        print(f"[release] codesign --verify OK: {app_path}", file=sys.stderr)


class NotarizeStep:
    """Submits the DMG to Apple notarization and waits for the result.
    Skipped (not failed) when no notary keychain profile is configured,
    regardless of whether signing happened."""

    def __init__(self, config: SigningConfig, runner: CommandRunner) -> None:
        self.config = config
        self.runner = runner

    def run(self, dmg_path: str | None) -> bool:
        if not self.config.can_notarize:
            reason = (
                "no signing identity"
                if not self.config.can_sign
                else "RGP_NOTARY_PROFILE not set"
            )
            print(f"[release] skip notarization: {reason}.", file=sys.stderr)
            return False
        if dmg_path is None:
            raise ReleaseSigningError(
                "notarization configured but no built DMG was found to submit"
            )
        result = self.runner.run(
            [
                "xcrun",
                "notarytool",
                "submit",
                dmg_path,
                "--keychain-profile",
                self.config.notary_profile,  # type: ignore[list-item]
                "--wait",
            ],
            check=False,
        )
        if result.returncode != 0:
            raise ReleaseSigningError(
                f"notarytool submit failed for {dmg_path}: {result.stderr}"
            )
        print(f"[release] notarytool submit OK: {dmg_path}", file=sys.stderr)
        return True


class StapleStep:
    """Staples the notarization ticket onto the DMG so Gatekeeper can verify
    it offline. Only runs when notarization actually succeeded."""

    def __init__(self, runner: CommandRunner) -> None:
        self.runner = runner

    def run(self, dmg_path: str | None, *, notarized: bool) -> None:
        if not notarized:
            print(
                "[release] skip stapler: notarization did not run/succeed.",
                file=sys.stderr,
            )
            return
        assert dmg_path is not None
        result = self.runner.run(["xcrun", "stapler", "staple", dmg_path], check=False)
        if result.returncode != 0:
            raise ReleaseSigningError(f"stapler staple failed for {dmg_path}: {result.stderr}")
        print(f"[release] stapler staple OK: {dmg_path}", file=sys.stderr)


class GatekeeperVerifyStep:
    """Runs the exact check Gatekeeper performs on a downloaded DMG:
    `spctl -a -t open --context context:primary-signature`. Always attempted
    (never skipped) — it's informative on an unsigned dev build (expected
    rejection) and is the acceptance gate for a real release. Non-fatal by
    default so an unsigned local build doesn't fail the whole script; the
    release recipe target treats a rejection as a hard failure only when a
    signing identity was configured (see recipe.py `release` wiring)."""

    def __init__(self, runner: CommandRunner) -> None:
        self.runner = runner

    def run(self, dmg_path: str | None) -> bool:
        if dmg_path is None:
            print("[release] skip spctl verify: no DMG found.", file=sys.stderr)
            return False
        result = self.runner.run(
            ["spctl", "-a", "-t", "open", "--context", SPCTL_CONTEXT, "-v", dmg_path],
            check=False,
        )
        accepted = result.returncode == 0
        verdict = "ACCEPTED" if accepted else "REJECTED"
        print(f"[release] spctl Gatekeeper check: {verdict} ({dmg_path})", file=sys.stderr)
        return accepted


def _find_first(pattern: str) -> str | None:
    matches = sorted(glob.glob(pattern))
    return matches[-1] if matches else None


class ReleaseOrchestrator:
    """Coordinates build -> sign-verify -> notarize -> staple -> gatekeeper-
    verify as one release pipeline. Each step owns its own skip/fail logic;
    this class only sequences them and decides the overall exit status."""

    def __init__(self, config: SigningConfig, *, dry_run: bool = False) -> None:
        self.config = config
        self.runner = CommandRunner(dry_run=dry_run)

    def run(self, *, skip_build: bool = False) -> int:
        try:
            if not skip_build:
                TauriBuildStep(self.config, self.runner).run()

            app_path = _find_first(APP_GLOB)
            dmg_path = _find_first(DMG_GLOB)

            CodesignVerifyStep(self.config, self.runner).run(app_path)
            notarized = NotarizeStep(self.config, self.runner).run(dmg_path)
            StapleStep(self.runner).run(dmg_path, notarized=notarized)
        except ReleaseSigningError as exc:
            print(f"[release] ERROR: {exc}", file=sys.stderr)
            return 1

        accepted = GatekeeperVerifyStep(self.runner).run(dmg_path)
        if self.config.can_sign and not accepted:
            print(
                "[release] ERROR: signing identity was configured but the "
                "built DMG did not pass Gatekeeper verification.",
                file=sys.stderr,
            )
            return 1
        if not self.config.can_sign:
            print(
                "[release] Unsigned build: spctl rejection above is expected "
                "(no Developer-ID identity configured in this environment). "
                "See docs/design/notarization-distribution-design.md §7.",
                file=sys.stderr,
            )
        return 0


def _self_test() -> int:
    """Stdlib-only, offline regression run of the skip/fail decision logic
    and command construction — no real codesign/notarytool/spctl/stapler
    invocation. Mirrors the `sync_deps.py --self-test` convention."""

    failures: list[str] = []

    def check(label: str, condition: bool) -> None:
        if not condition:
            failures.append(label)

    # No credentials at all -> everything skips, nothing fails.
    empty = SigningConfig.from_env({})
    check("empty config cannot sign", not empty.can_sign)
    check("empty config cannot notarize", not empty.can_notarize)

    runner = CommandRunner(dry_run=True)
    CodesignVerifyStep(empty, runner).run(app_path=None)
    check("codesign step made no calls when unsigned", runner.invocations == [])

    notarize_result = NotarizeStep(empty, runner).run(dmg_path=None)
    check("notarize step returns False when unconfigured", notarize_result is False)
    check("notarize step made no calls when unconfigured", runner.invocations == [])

    StapleStep(runner).run(dmg_path=None, notarized=False)
    check("staple step made no calls when not notarized", runner.invocations == [])

    # Signing identity only -> can sign, still cannot notarize.
    signed_only = SigningConfig.from_env(
        {"RGP_SIGNING_IDENTITY": "Developer ID Application: Test (ABCDE12345)"}
    )
    check("signing-only config can sign", signed_only.can_sign)
    check("signing-only config cannot notarize", not signed_only.can_notarize)

    # Signing missing but notary profile set -> still cannot notarize
    # (notarization requires a signed artifact).
    profile_only = SigningConfig.from_env({"RGP_NOTARY_PROFILE": "some-profile"})
    check("profile-only config cannot notarize without signing", not profile_only.can_notarize)

    # Full config -> can do both, and command construction is correct.
    full = SigningConfig.from_env(
        {
            "RGP_SIGNING_IDENTITY": "Developer ID Application: Test (ABCDE12345)",
            "RGP_APPLE_TEAM_ID": "ABCDE12345",
            "RGP_NOTARY_PROFILE": "retro-game-player-notary",
        }
    )
    check("full config can sign", full.can_sign)
    check("full config can notarize", full.can_notarize)

    runner2 = CommandRunner(dry_run=True)
    CodesignVerifyStep(full, runner2).run(app_path="/tmp/Fake.app")
    check(
        "codesign invocation includes --verify and the app path",
        runner2.invocations
        and runner2.invocations[0][:2] == ["codesign", "--verify"]
        and runner2.invocations[0][-1] == "/tmp/Fake.app",
    )

    runner3 = CommandRunner(dry_run=True)
    NotarizeStep(full, runner3).run(dmg_path="/tmp/Fake.dmg")
    check(
        "notarytool invocation includes submit + keychain-profile + --wait",
        runner3.invocations
        and runner3.invocations[0][:3] == ["xcrun", "notarytool", "submit"]
        and "--keychain-profile" in runner3.invocations[0]
        and "--wait" in runner3.invocations[0],
    )

    runner4 = CommandRunner(dry_run=True)
    StapleStep(runner4).run(dmg_path="/tmp/Fake.dmg", notarized=True)
    check(
        "stapler invocation is xcrun stapler staple <path>",
        runner4.invocations == [["xcrun", "stapler", "staple", "/tmp/Fake.dmg"]],
    )

    runner5 = CommandRunner(dry_run=True)
    GatekeeperVerifyStep(runner5).run(dmg_path="/tmp/Fake.dmg")
    check(
        "spctl invocation uses context:primary-signature",
        runner5.invocations
        and SPCTL_CONTEXT in runner5.invocations[0],
    )

    # A failed build must surface via the same "[release] ERROR: ..." +
    # return-1 path as codesign/notarize/staple failures, not as an
    # uncaught exception — TauriBuildStep.run() is invoked from inside
    # ReleaseOrchestrator.run()'s try/except.
    class _FailingBuildStep:
        def run(self) -> None:
            raise ReleaseSigningError("pnpm tauri build failed (exit 1)")

    orchestrator = ReleaseOrchestrator(empty)
    real_tauri_build_step = TauriBuildStep

    def _raise_build_failure(config: SigningConfig, runner: CommandRunner) -> "_FailingBuildStep":
        return _FailingBuildStep()

    globals_ref = sys.modules[__name__]
    globals_ref.TauriBuildStep = _raise_build_failure  # type: ignore[assignment]
    try:
        build_failure_rc = orchestrator.run(skip_build=False)
    finally:
        globals_ref.TauriBuildStep = real_tauri_build_step  # type: ignore[assignment]
    check("build failure returns exit code 1, not an uncaught exception", build_failure_rc == 1)

    if failures:
        print("[self-test] FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(f"[self-test] all {5 + 8 + 1} checks passed.", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run the offline, stdlib-only regression suite and exit.",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Reuse the existing bundle output instead of rebuilding.",
    )
    args = parser.parse_args(argv)

    if args.self_test:
        return _self_test()

    config = SigningConfig.from_env()
    orchestrator = ReleaseOrchestrator(config)
    return orchestrator.run(skip_build=args.skip_build)


if __name__ == "__main__":
    sys.exit(main())

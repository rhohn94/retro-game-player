// Wires scripts/release_sign_notarize.py's stdlib-only --self-test into
// `pnpm test` (W335), so the DMG-assembly fix (BundleMacosGuard +
// DmgStagingBuilder — see docs/design/notarization-distribution-design.md
// §DMG assembly) is covered by the project's normal test run instead of
// being a script only a human remembers to invoke manually. Shells out to
// `python3` and asserts on exit code + the self-test's own pass/fail report;
// it never invokes a real hdiutil/codesign/notarytool/spctl (the Python
// script's own CommandRunner subprocess seam stays dry_run inside
// --self-test).

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "release_sign_notarize.py");

describe("release_sign_notarize.py --self-test", () => {
  it("passes its offline, stdlib-only regression suite", () => {
    const result = spawnSync("python3", [SCRIPT, "--self-test"], {
      encoding: "utf-8",
    });

    expect(result.status, `stderr:\n${result.stderr}`).toBe(0);
    expect(result.stderr).toMatch(/\[self-test\] all \d+ checks passed\./);
    expect(result.stderr).not.toMatch(/\[self-test\] FAILED/);
  });
});

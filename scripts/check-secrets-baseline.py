#!/usr/bin/env python3
"""OSE-911 — committed-secret gate, replacing the flaky gitleaks step.

gitleaks compiled its regex rules through go-re2 -> wazero, whose amd64 WASM JIT
panicked nondeterministically on the self-hosted Windows runners (exit 2, a
tooling crash, not a finding) and intermittently failed the required S0/S2
checks. detect-secrets (pure Python, no WASM JIT) is stable there and was already
running in S0.

This script makes detect-secrets the *enforcing* gate the way gitleaks was:

  1. Run `detect-secrets scan` over the working tree (same excludes as the old
     step) to get the current set of detections.
  2. Compare the set of (file, hashed_secret) pairs against the committed
     .secrets.baseline. Only a *new* secret — one not already accepted in the
     baseline — fails the gate. Line-number churn on an already-known secret does
     NOT fail it (we key on hashed_secret, not location), so this is not flaky.

To accept a genuinely-new-but-false-positive detection, re-baseline:

    python -m detect_secrets scan \
      --exclude-files 'package-lock\\.json' --exclude-files '\\.gitleaks\\.toml' \
      --exclude-files '.*\\.spec\\.ts' --exclude-files 'vitest\\..*config.*' \
      --exclude-files '\\.secrets\\.baseline' --exclude-files '^archive[\\\\/]' \
      > .secrets.baseline

and commit the updated .secrets.baseline (review the diff first).
"""
import json
import os
import subprocess
import sys

BASELINE = os.environ.get("SECRETS_BASELINE", ".secrets.baseline")

# Kept in lockstep with the re-baseline command in this module's docstring.
# archive/ holds retired legacy code + analysis reports (GAS, v2 docs, legacy
# tests full of mock/fake keys) — not a deployed credential-leak surface, so it
# is excluded from the secret gate (OSE-1018). The pattern matches both path
# separators so it excludes on Linux CI (archive/) and a Windows re-baseline
# (archive\) alike.
EXCLUDES = [
    r"package-lock\.json",
    r"\.gitleaks\.toml",
    r".*\.spec\.ts",
    # vitest config files hold test-only fake secrets. OSE-946 split the single
    # vitest.config.mts into vitest.config.mts (projects root) +
    # vitest.workers.config.mts + vitest.node.config.mts, so the pattern matches
    # any `vitest.<...>config.*`, not just the literal `vitest.config.*`.
    r"vitest\..*config.*",
    r"\.secrets\.baseline",
    r"^archive[\\/]",
]


def pairs(doc):
    """Set of (normalized-path, hashed_secret) for every detection in a baseline doc.

    Paths are normalized to forward slashes so a baseline written on Windows
    matches a scan run on any OS.
    """
    return {
        (f.replace("\\", "/"), entry["hashed_secret"])
        for f, entries in doc.get("results", {}).items()
        for entry in entries
    }


def _emit_summary(line):
    print(line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


def main():
    if not os.path.exists(BASELINE):
        print(f"::error::secret baseline not found at {BASELINE}", file=sys.stderr)
        return 1

    cmd = [sys.executable, "-m", "detect_secrets", "scan"]
    for pattern in EXCLUDES:
        cmd += ["--exclude-files", pattern]
    scan = subprocess.run(cmd, capture_output=True, text=True)
    if scan.returncode != 0:
        print(
            f"::error::detect-secrets scan failed (exit {scan.returncode}): "
            f"{scan.stderr.strip()[:500]}",
            file=sys.stderr,
        )
        return 1

    current = json.loads(scan.stdout)
    with open(BASELINE, encoding="utf-8") as fh:
        baseline = json.load(fh)

    new = pairs(current) - pairs(baseline)
    total = sum(len(v) for v in current.get("results", {}).values())
    _emit_summary(
        f"- **detect-secrets:** {total} known detections, "
        f"{len(new)} NEW vs baseline"
    )

    if new:
        print(
            "::error::detect-secrets found secret(s) not present in "
            f"{BASELINE}:"
        )
        for path, hashed in sorted(new):
            print(f"  NEW  {path}  ({hashed})")
        print(
            "If these are false positives, re-baseline per the header of "
            "scripts/check-secrets-baseline.py and commit .secrets.baseline."
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

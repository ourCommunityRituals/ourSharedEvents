#!/usr/bin/env python3
"""
Invariant registry <-> repo reconciliation (OSE-1604).

The brain registry (OCR-docs/ocr-docs-brain/architectural-invariants.yaml) names a
`test_file` for every invariant. This check joins that claim to the repo:

  1. Every non-retired invariant's test_file must resolve to a real path.
     A miss is a failure unless it is listed, with a reason, in
     `.invariant-registry-baseline.json`.
  2. The baseline is a ratchet: an entry whose file now resolves must be
     removed (the count may fall, never rise, and a fall must be recorded).
  3. `tests/e2e/0-architecture/README.md` carries a GENERATED gate index between
     BEGIN/END markers: every `*.invariant.spec.ts` in that folder, joined to the
     brain invariant(s) that name it. Hand edits inside the markers fail the check.
     Regenerate with `--write`.

Generated, never written: the index is derived from the YAML and the directory.

Usage:
  python3 scripts/check-invariant-registry.py --brain <ocr-docs-brain dir> [--repo <root>] [--write]
Exit 0 = clean, 1 = drift, 2 = bad input.
"""
import argparse
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - environment fault, not drift
    print("::error::pyyaml is not installed in this python3", file=sys.stderr)
    sys.exit(2)

BEGIN = "<!-- BEGIN GENERATED: gate-index (scripts/check-invariant-registry.py --write) -->"
END = "<!-- END GENERATED: gate-index -->"
GATE_DIR = Path("tests/e2e/0-architecture")
BASELINE = Path(".invariant-registry-baseline.json")


def clean_path(raw):
    """`path (annotation)` -> `path`. The annotation is prose, not part of the path."""
    return str(raw).split(" (")[0].strip()


def resolve(test_file, repo, brain):
    """Return the Path the claim resolves to, or None when it does not exist."""
    token = clean_path(test_file)
    candidates = []
    if token.startswith("ocr-docs-brain/"):
        candidates.append(brain.parent / token)
    elif "/" not in token and token.endswith(".py"):
        candidates += sorted(brain.rglob(token))
    elif "/" not in token:
        candidates.append(repo / GATE_DIR / token)
    else:
        candidates += [repo / token, repo / "workers" / "oursharedevents" / token]
    for c in candidates:
        if c.exists():
            return c
    return None


def load_invariants(brain):
    doc = yaml.safe_load((brain / "architectural-invariants.yaml").read_text(encoding="utf-8"))
    return doc["invariants"]


def render_index(invs, repo):
    by_file = {}
    for inv in invs:
        by_file.setdefault(clean_path(inv.get("test_file", "")), []).append(inv)
    rows = []
    for spec in sorted(p.name for p in (repo / GATE_DIR).glob("*.invariant.spec.ts")):
        owners = by_file.get(spec, []) + by_file.get(str(GATE_DIR / spec).replace("\\", "/"), [])
        if owners:
            cell = ", ".join(f"#{o['id']} {o['name']} ({o['status']})" for o in owners)
        else:
            cell = "— (OSE-local or derived gate, not the named test of a brain invariant)"
        rows.append(f"| `{spec}` | {cell} |")
    return "\n".join(
        [
            BEGIN,
            "",
            "| Gate spec | Brain invariant that names it |",
            "| --------- | ----------------------------- |",
            *rows,
            "",
            END,
        ]
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brain", required=True, type=Path)
    ap.add_argument("--repo", default=Path("."), type=Path)
    ap.add_argument("--write", action="store_true", help="regenerate the README gate index")
    args = ap.parse_args()
    repo, brain = args.repo.resolve(), args.brain.resolve()
    if not (brain / "architectural-invariants.yaml").exists():
        print(f"::error::no architectural-invariants.yaml under {brain}", file=sys.stderr)
        return 2

    invs = load_invariants(brain)
    baseline_path = repo / BASELINE
    baseline = (
        json.loads(baseline_path.read_text(encoding="utf-8")).get("missing_test_file", {})
        if baseline_path.exists()
        else {}
    )
    failures = []

    seen_missing = set()
    for inv in invs:
        if inv.get("status") == "retired":
            continue
        key = str(inv["id"])
        tf = inv.get("test_file")
        if not tf:
            failures.append(f"#{key} {inv['name']}: status {inv['status']} but no test_file")
            continue
        if resolve(tf, repo, brain) is None:
            seen_missing.add(key)
            if key not in baseline:
                failures.append(
                    f"#{key} {inv['name']} ({inv['status']}): test_file `{clean_path(tf)}` "
                    f"does not exist (fix the brain or add the test; or baseline it WITH a reason)"
                )
    for key, reason in baseline.items():
        if not str(reason).strip():
            failures.append(f"baseline #{key} has no reason")
        if key not in seen_missing:
            failures.append(
                f"baseline #{key} now resolves (or is retired/removed): delete it from {BASELINE} "
                f"(the ratchet only shrinks)"
            )

    readme = repo / GATE_DIR / "README.md"
    fresh = render_index(invs, repo)
    text = readme.read_text(encoding="utf-8") if readme.exists() else ""
    m = re.search(re.escape(BEGIN) + r".*?" + re.escape(END), text, re.S)
    if args.write:
        if m:
            text = text[: m.start()] + fresh + text[m.end() :]
        else:
            text = (
                text.rstrip("\n")
                + "\n\n## Gate index (generated)\n\n<!-- prettier-ignore-start -->\n"
                + fresh
                + "\n<!-- prettier-ignore-end -->\n"
            )
        readme.write_text(text, encoding="utf-8")
        print(f"wrote gate index to {readme}")
    elif not m:
        failures.append(f"{GATE_DIR.as_posix()}/README.md has no generated gate-index block (run with --write)")
    elif m.group(0) != fresh:
        failures.append(
            f"{GATE_DIR.as_posix()}/README.md gate index is stale or hand-edited (run with --write)"
        )

    for f in failures:
        print(f"::error::{f}")
    if failures:
        print(f"invariant registry check: {len(failures)} problem(s)")
        return 1
    print("invariant registry check: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())

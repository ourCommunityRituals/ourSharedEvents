#!/usr/bin/env python3
"""
pragma_audit.py — Canonical policy enforcement for the inline
`security-gate: allow <check>` escape hatch.

Every repo running the security gate vendors this module via the same
sync pattern as `security_gate.py`. Each repo's `tests/level0_security.py`
imports `run_audit(root)` and layers it onto the baseline.

Policy (intentionally strict):

  - `secret_scan` pragmas are FORBIDDEN everywhere. A secret that needs
    to be inline-allowed is a secret that does not belong in the repo.

  - `pii_scan` and `forbidden_url_scan` pragmas are capped at
    MAX_PER_CHECK per scanned tree. Above the cap = fail.

  - Every pragma must carry a rationale on the same line after `—` or
    `--`. Format: `security-gate: allow <check> — <why>`. Pragmas
    without a rationale fail audit.

Canonical path: OCR-docs/shared/pragma_audit.py
Mirror into consumer repos via `shared/sync_to_repos.py`.
"""
from __future__ import annotations
import re
from pathlib import Path
from typing import Iterable

FORBIDDEN_CHECKS = {'secret_scan'}
MAX_PER_CHECK_DEFAULT = 10

PRAGMA_RE = re.compile(r'security-gate:\s*allow\s+([a-z_]+)(.*)$', re.MULTILINE)

DEFAULT_EXCLUDE_DIRS = {
    'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
    '.venv', 'venv', '__pycache__', '_shared', 'playwright-report',
    'test-results', 'worktrees', 'archive',
}
DEFAULT_INCLUDE_SUFFIXES = {
    '.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.html', '.md',
    '.yaml', '.yml', '.json', '.css', '.scss',
}


def _iter_files(root: Path, exclude_dirs: Iterable[str], include_suffixes: Iterable[str]):
    exclude_dirs = set(exclude_dirs)
    include_suffixes = set(include_suffixes)
    for p in root.rglob('*'):
        if not p.is_file():
            continue
        if any(part in exclude_dirs for part in p.parts):
            continue
        if p.suffix.lower() not in include_suffixes:
            continue
        # Never audit this module itself — it contains the literal pattern.
        if p.name == 'pragma_audit.py':
            continue
        yield p


def run_audit(
    root: Path,
    max_per_check: int = MAX_PER_CHECK_DEFAULT,
    exclude_dirs: Iterable[str] = DEFAULT_EXCLUDE_DIRS,
    include_suffixes: Iterable[str] = DEFAULT_INCLUDE_SUFFIXES,
) -> list[tuple[str, str, str]]:
    """Scan `root` for pragmas; return list of (check_name, 'FAIL', detail).
    Empty list means policy clean."""
    root = Path(root)
    fails: list[tuple[str, str, str]] = []
    counts: dict[str, int] = {}

    for f in _iter_files(root, exclude_dirs, include_suffixes):
        try:
            text = f.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for m in PRAGMA_RE.finditer(text):
            check = m.group(1)
            rest = (m.group(2) or '').strip()
            line_no = text.count('\n', 0, m.start()) + 1
            rel = f.relative_to(root) if f.is_relative_to(root) else f
            loc = f'{rel}:{line_no}'

            if check in FORBIDDEN_CHECKS:
                fails.append(('pragma_audit', 'FAIL',
                              f'forbidden pragma `{check}` @ {loc} — '
                              f'this check may never be inline-exempted'))
                continue

            # Rationale required (em-dash OR ASCII double-dash).
            if '—' not in rest and '--' not in rest:
                fails.append(('pragma_audit', 'FAIL',
                              f'pragma missing rationale @ {loc} — format: '
                              f'security-gate: allow <check> -- <why>'))

            counts[check] = counts.get(check, 0) + 1

    for check, n in counts.items():
        if n > max_per_check:
            fails.append(('pragma_audit', 'FAIL',
                          f'pragma cap exceeded for `{check}`: {n} > {max_per_check}'))

    return fails


def summary(counts: dict[str, int], max_per_check: int = MAX_PER_CHECK_DEFAULT) -> str:
    if not counts:
        return '(no pragmas found)'
    return ', '.join(f'{c}={n}/{max_per_check}' for c, n in sorted(counts.items()))


# Support being invoked as a standalone script for local dev.
if __name__ == '__main__':
    import sys
    root_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    fails = run_audit(root_arg)
    print('=' * 72)
    print(f'  PRAGMA AUDIT — {root_arg}')
    print('=' * 72)
    if fails:
        for _, _, msg in fails:
            print(f'  [FAIL] {msg}')
        print('-' * 72)
        print(f'  {len(fails)} violation(s)')
        sys.exit(1)
    print('  policy clean')
    sys.exit(0)

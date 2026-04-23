#!/usr/bin/env python3
"""
security_gate.py — Shared baseline security checks
===================================================
Canonical source of truth imported by every application repo's
`tests/level0_security.py`. Ships four check functions:

    scan_secrets(root)         — token-shaped strings (AWS, GitHub PAT, JWT, generic)
    scan_pii(root)             — emails, US phone numbers, SSN patterns
    scan_forbidden_urls(root)  — localhost, http://, pastebin/gist in governance docs
    run_adjacent_sec_iac(path) — shell out to adjacent OSE sec-iac-*.test.js if present

Every app repo's level0_security.py must call these four, then layer its own
repo-specific checks on top. Security is the Level 0 gate — if any check
fails, the pyramid stops. Nothing else runs until security is green.

Canonical path: OCR-docs/shared/security_gate.py
Mirror into each app repo via its level0_security.py import.
"""
from __future__ import annotations
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable

SECRET_PATTERNS = [
    (re.compile(r'AKIA[0-9A-Z]{16}'), 'AWS access key id'),
    (re.compile(r'aws(.{0,20})?(secret|private).{0,20}?[\'"][0-9a-zA-Z/+]{40}[\'"]', re.I), 'AWS secret-like'),
    (re.compile(r'ghp_[0-9a-zA-Z]{36}'), 'GitHub personal access token'),
    (re.compile(r'gho_[0-9a-zA-Z]{36}'), 'GitHub OAuth token'),
    (re.compile(r'ghs_[0-9a-zA-Z]{36}'), 'GitHub app token'),
    (re.compile(r'xox[baprs]-[0-9a-zA-Z-]{10,}'), 'Slack token'),
    (re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'), 'JWT-shaped token'),
    (re.compile(r'-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----'), 'PEM private key'),
    (re.compile(r'sk-[A-Za-z0-9]{20,}'), 'OpenAI-shaped secret key'),
]

PII_PATTERNS = [
    (re.compile(r'\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b'), 'SSN-shaped'),
    (re.compile(r'\b(?!555-01)[2-9][0-9]{2}-[0-9]{3}-[0-9]{4}\b'), 'US phone number'),
]

FORBIDDEN_URL_PATTERNS = [
    (re.compile(r'https?://localhost[:/]'), 'localhost URL'),
    (re.compile(r'https?://127\.0\.0\.1'), 'loopback IP URL'),
    (re.compile(r'https?://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'), 'bare IP URL'),
    (re.compile(r'https?://pastebin\.com/'), 'pastebin link'),
    (re.compile(r'https?://gist\.github\.com/'), 'personal gist link'),
    (re.compile(r'http://(?!localhost|127\.)'), 'non-TLS http:// URL'),
]

DEFAULT_INCLUDE_SUFFIXES = {'.md', '.yaml', '.yml', '.json', '.toml', '.ini', '.env', '.txt', '.js', '.ts', '.py', '.sh'}
DEFAULT_EXCLUDE_DIRS = {'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv', 'venv', '__pycache__', 'playwright-report', 'test-results', 'worktrees', 'archive'}

# forbidden_url_scan is strictly for production source. Tests/docs/schemas
# legitimately reference localhost and http:// (test fixtures, protocol
# discussion in docs, JSON-Schema namespace URIs). These are excluded by
# default so the gate flags real production-code violations only.
URL_SCAN_EXTRA_EXCLUDE_DIRS = {'tests', 'test', '__tests__', 'spec', 'docs', 'doc', 'schemas', 'schema', 'examples', 'example', 'fixtures', '.github'}
URL_SCAN_ALLOWLIST_PREFIXES = (
    'http://json-schema.org/',
    'http://www.w3.org/',
    'http://schema.org/',
    'http://localhost.test/',
)

# Inline-pragma support. A hit is suppressed when the matched line OR the
# preceding line contains `security-gate: allow <check_name>`. The check
# name must match exactly (secret_scan, pii_scan, or forbidden_url_scan).
# Use sparingly — pragmas are auditable in code review and should carry a
# why-comment next to them. This exists so legitimate local-dev URLs and
# known benign strings don't force obfuscated source.
PRAGMA_PATTERN = re.compile(r'security-gate:\s*allow\s+([a-z_]+)')


def _has_allow_pragma(text: str, match_start: int, check_name: str) -> bool:
    line_start = text.rfind('\n', 0, match_start) + 1
    line_end = text.find('\n', match_start)
    if line_end == -1:
        line_end = len(text)
    same_line = text[line_start:line_end]
    for m in PRAGMA_PATTERN.finditer(same_line):
        if m.group(1) == check_name:
            return True
    if line_start > 0:
        prev_line_end = line_start - 1
        prev_line_start = text.rfind('\n', 0, prev_line_end) + 1
        prev_line = text[prev_line_start:prev_line_end]
        for m in PRAGMA_PATTERN.finditer(prev_line):
            if m.group(1) == check_name:
                return True
    return False


def _iter_files(root: Path, include: Iterable[str] = DEFAULT_INCLUDE_SUFFIXES,
                exclude_dirs: Iterable[str] = DEFAULT_EXCLUDE_DIRS) -> Iterable[Path]:
    include = set(include)
    exclude_dirs = set(exclude_dirs)
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        if any(part in exclude_dirs for part in path.parts):
            continue
        if path.suffix.lower() not in include:
            continue
        yield path


def _scan(root: Path, patterns, check_name: str, allowlist_names: Iterable[str] = (),
          extra_exclude_dirs: Iterable[str] = (),
          match_allowlist_prefixes: tuple[str, ...] = ()) -> list[tuple[str, str, str]]:
    """Returns list of (check_name, 'FAIL', detail). Empty list = all clean."""
    root = Path(root)
    hits: list[tuple[str, str, str]] = []
    allowlist_names = set(allowlist_names)
    exclude_dirs = DEFAULT_EXCLUDE_DIRS | set(extra_exclude_dirs)
    for f in _iter_files(root, exclude_dirs=exclude_dirs):
        if f.name in allowlist_names:
            continue
        try:
            text = f.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for pattern, label in patterns:
            for m in pattern.finditer(text):
                if match_allowlist_prefixes and any(m.group(0).startswith(p) for p in match_allowlist_prefixes):
                    continue
                if _has_allow_pragma(text, m.start(), check_name):
                    continue
                line_no = text.count('\n', 0, m.start()) + 1
                rel = f.relative_to(root) if f.is_relative_to(root) else f
                hits.append((check_name, 'FAIL', f'{label} @ {rel}:{line_no}'))
    return hits


def scan_secrets(root: Path, allowlist_names: Iterable[str] = ()) -> list[tuple[str, str, str]]:
    return _scan(root, SECRET_PATTERNS, 'secret_scan', allowlist_names)


def scan_pii(root: Path, allowlist_names: Iterable[str] = ()) -> list[tuple[str, str, str]]:
    return _scan(root, PII_PATTERNS, 'pii_scan', allowlist_names)


def scan_forbidden_urls(root: Path, allowlist_names: Iterable[str] = (),
                        prod_code_dirs: Iterable[str] = ()) -> list[tuple[str, str, str]]:
    """Scan for forbidden URLs (localhost, http://, bare IPs) in production code.

    If `prod_code_dirs` is provided, only scan those subtrees of `root`
    (e.g., ('src', 'workers/oursharedevents/src')). This is the recommended
    mode — production code should never reference localhost or non-TLS URLs.
    Dev configs, tests, docs, and load scripts legitimately do.

    If `prod_code_dirs` is empty, scan everything except DEFAULT + URL_SCAN_EXTRA
    exclude dirs. Use this only if a repo doesn't separate prod from non-prod.
    """
    root = Path(root)
    prod_code_dirs = list(prod_code_dirs)
    if not prod_code_dirs:
        return _scan(root, FORBIDDEN_URL_PATTERNS, 'forbidden_url_scan', allowlist_names,
                     extra_exclude_dirs=URL_SCAN_EXTRA_EXCLUDE_DIRS,
                     match_allowlist_prefixes=URL_SCAN_ALLOWLIST_PREFIXES)
    hits: list[tuple[str, str, str]] = []
    for sub in prod_code_dirs:
        sub_root = root / sub
        if not sub_root.exists():
            continue
        hits.extend(_scan(sub_root, FORBIDDEN_URL_PATTERNS, 'forbidden_url_scan', allowlist_names,
                          extra_exclude_dirs=URL_SCAN_EXTRA_EXCLUDE_DIRS,
                          match_allowlist_prefixes=URL_SCAN_ALLOWLIST_PREFIXES))
    return hits


def run_adjacent_sec_iac(ose_repo: Path) -> list[tuple[str, str, str]]:
    """Shell out to OSE's sec-iac-*.test.js if present. Empty list if not applicable."""
    ose_repo = Path(ose_repo)
    tests_glob = list((ose_repo / 'tests' / 'unit' / 'worker').glob('sec-iac-*.test.js')) if (ose_repo / 'tests' / 'unit' / 'worker').exists() else []
    if not tests_glob:
        return []
    cmd = ['npx', 'vitest', 'run'] + [str(p) for p in tests_glob]
    try:
        r = subprocess.run(cmd, cwd=str(ose_repo), capture_output=True, text=True, timeout=120, shell=(sys.platform == 'win32'))  # nosemgrep: python.lang.security.audit.subprocess-shell-true.subprocess-shell-true
        if r.returncode != 0:
            tail = (r.stdout + r.stderr).strip().splitlines()[-5:]
            return [('sec_iac_shell', 'FAIL', f'vitest exit {r.returncode}: {" | ".join(tail)}')]
    except FileNotFoundError:
        return [('sec_iac_shell', 'FAIL', 'npx not on PATH')]
    except subprocess.TimeoutExpired:
        return [('sec_iac_shell', 'FAIL', 'timeout after 120s')]
    return []


def run_baseline(root: Path, allowlist_names: Iterable[str] = (),
                 adjacent_ose: Path | None = None,
                 prod_code_dirs: Iterable[str] = ()) -> list[tuple[str, str, str]]:
    """One-call baseline. Returns list of failures (empty = all clean).

    `prod_code_dirs` scopes forbidden_url_scan to production code subtrees.
    Pass e.g. ('src', 'workers/oursharedevents/src'). If empty, scans
    everywhere except docs/tests/schemas (legacy mode).
    """
    fails: list[tuple[str, str, str]] = []
    fails += scan_secrets(root, allowlist_names)
    fails += scan_pii(root, allowlist_names)
    fails += scan_forbidden_urls(root, allowlist_names, prod_code_dirs=prod_code_dirs)
    if adjacent_ose is not None:
        fails += run_adjacent_sec_iac(adjacent_ose)
    return fails


def report_and_exit(check_results: list[tuple[str, str, str]], passed_count: int, header: str = 'LEVEL 0 — SECURITY') -> None:
    """Print a pyramid-style report and exit 0 if clean, 1 if any FAIL."""
    failed = [r for r in check_results if r[1] == 'FAIL']
    print(f'{"="*76}')
    print(f'  {header}')
    print(f'{"="*76}')
    if not failed and passed_count == 0:
        print('  [WARN]  no baseline checks ran — security gate is a no-op')
    for name, status, detail in check_results:
        m = '[PASS]' if status == 'PASS' else '[FAIL]'
        print(f'  {m}  {name:32} {detail}')
    print(f'{"-"*76}')
    print(f'  {passed_count} pass / {len(failed)} fail  (total {passed_count + len(failed)})')
    print(f'{"-"*76}')
    sys.exit(0 if not failed else 1)

#!/usr/bin/env python3
"""
Level 0 — SECURITY (OurSharedEvents pyramid)
=============================================
Runs FIRST. Gate: blocks every other level on failure.
Imports baseline checks from OCR-docs/shared/security_gate.py and shells
out to OSE's existing sec-iac-*.test.js suite as the OSE-specific layer.
"""
import sys
from pathlib import Path

THIS_DIR = Path(__file__).parent
OSE_REPO = THIS_DIR.parent
SHARED = (OSE_REPO.parent / 'OCR-docs' / 'shared').resolve()

sys.path.insert(0, str(SHARED))
try:
    import security_gate
except ImportError as e:
    print('[FAIL]  shared security_gate.py not importable from OCR-docs/shared/')
    print(f'        looked at: {SHARED}')
    print(f'        error: {e}')
    print('        SECURITY GATE FAILS CLOSED — fix the shared module path before continuing.')
    sys.exit(1)

results: list[tuple[str, str, str]] = []
passed = 0


def check(name: str, ok: bool, detail: str = '') -> None:
    global passed
    if ok:
        results.append((name, 'PASS', detail))
        passed += 1
    else:
        results.append((name, 'FAIL', detail))


fails = security_gate.run_baseline(
    OSE_REPO,
    allowlist_names=('security_gate.py', 'level0_security.py', 'package-lock.json', 'dependabot-alerts.json'),
    adjacent_ose=OSE_REPO,
    prod_code_dirs=('src', 'workers/oursharedevents/src'),
)
results.extend(fails)
baseline_check_names = ('secret_scan', 'pii_scan', 'forbidden_url_scan')
for n in baseline_check_names:
    if not any(r[0] == n and r[1] == 'FAIL' for r in fails):
        check(n, True, 'clean')
if not any(r[0] == 'sec_iac_shell' and r[1] == 'FAIL' for r in fails):
    check('sec_iac_shell', True, 'sec-iac-*.test.js passed (or no tests present)')

worker_dir = OSE_REPO / 'workers' / 'oursharedevents'
if worker_dir.exists():
    wrangler = worker_dir / 'wrangler.toml'
    if wrangler.exists():
        text = wrangler.read_text(encoding='utf-8', errors='ignore')
        for forbidden in ('--allow-secrets', 'compatibility_flags = ["allow-eval"]'):
            check(f'wrangler_no_dangerous:{forbidden[:30]}', forbidden not in text,
                  'absent' if forbidden not in text else f'forbidden flag present: {forbidden}')

security_gate.report_and_exit(results, passed, header='LEVEL 0 — SECURITY (OurSharedEvents)')

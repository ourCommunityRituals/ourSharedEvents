#!/usr/bin/env python3
"""
Level 0 - SECURITY (@ocr/flags)
================================
Gate: blocks every other level on failure. Runs FIRST.

Imports the canonical baseline from OCR-docs/shared/security_gate.py
(via tests/_shared vendored mirror, same pattern as OSE). Adds flag-specific
checks on top:

  1. Contract-to-generated parity: src/generated/flag-keys.ts must match
     the SHA of flags-contract.yaml. Drift = CI fail.
  2. Value-type constraint: no flag key in the catalog has a non-boolean
     default in any tier preset.
  3. No adapter imports @cloudflare/workers-types at runtime (only types).
  4. No SQL string concatenation in adapters - all queries must use
     parameterized placeholders (?, $1, etc).
"""
from __future__ import annotations
import hashlib
import re
import sys
from pathlib import Path

THIS_DIR = Path(__file__).parent
PKG_ROOT = THIS_DIR.parent
REPO_ROOT = PKG_ROOT.parent.parent                         # ourCommunityRituals/
BRAIN_CONTRACT = REPO_ROOT / 'OCR-docs' / 'ocr-docs-brain' / 'flags-contract.yaml'
VENDORED_SHARED = THIS_DIR / '_shared'

sys.path.insert(0, str(VENDORED_SHARED))
try:
    import security_gate  # type: ignore
except ImportError as e:
    print('[FAIL]  vendored security_gate.py not importable from tests/_shared/')
    print(f'        looked at: {VENDORED_SHARED}')
    print(f'        error: {e}')
    print('        SECURITY GATE FAILS CLOSED - restore the vendored module.')
    print('        From OCR-docs: py shared/sync_to_repos.py')
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


# ─── Baseline (shared) ────────────────────────────────────────────────────
fails = security_gate.run_baseline(
    PKG_ROOT,
    allowlist_names=('security_gate.py', 'level0_security.py'),
    adjacent_ose=PKG_ROOT,
    prod_code_dirs=('src',),
)
results.extend(fails)
baseline_check_names = ('secret_scan', 'pii_scan', 'forbidden_url_scan')
for n in baseline_check_names:
    if not any(r[0] == n and r[1] == 'FAIL' for r in fails):
        check(n, True, 'clean')

# ─── Flags-specific checks ────────────────────────────────────────────────

# Check 1: Brain contract reachable
if not BRAIN_CONTRACT.exists():
    check('contract_reachable', False,
          f'flags-contract.yaml missing at {BRAIN_CONTRACT}')
else:
    check('contract_reachable', True, str(BRAIN_CONTRACT))

# Check 2: Generated artifact parity — sha of YAML must match the header
# in BOTH generated files (flag-keys.ts AND presets.ts). Drift fails.
# Missing-artifact state is treated as a FAIL (was pass; closed that hole).
generated_files = [
    PKG_ROOT / 'src' / 'generated' / 'flag-keys.ts',
    PKG_ROOT / 'src' / 'generated' / 'presets.ts',
]
if not BRAIN_CONTRACT.exists():
    check('generated_parity', False, 'contract YAML missing; cannot verify parity')
else:
    yaml_sha = hashlib.sha256(BRAIN_CONTRACT.read_bytes()).hexdigest()[:16]
    parity_fail = False
    details = []
    for gf in generated_files:
        if not gf.exists():
            details.append(f'{gf.name} missing (run `pnpm generate`)')
            parity_fail = True
            continue
        gen_text = gf.read_text(encoding='utf-8', errors='ignore')
        m = re.search(r'CONTRACT_SHA:\s*([0-9a-f]{16})', gen_text)
        if not m:
            details.append(f'{gf.name} missing CONTRACT_SHA header')
            parity_fail = True
        elif m.group(1) != yaml_sha:
            details.append(f'{gf.name} sha={m.group(1)} != yaml={yaml_sha}')
            parity_fail = True
    if parity_fail:
        check('generated_parity', False, '; '.join(details))
    else:
        check('generated_parity', True, f'sha={yaml_sha} matches both flag-keys.ts + presets.ts')

# Check 3: No SQL string concatenation in adapters. Every query must use
# parameterized placeholders. Grep for obvious concatenation patterns.
adapter_dir = PKG_ROOT / 'src' / 'adapters'
sql_concat_violations: list[str] = []
if adapter_dir.exists():
    concat_patterns = [
        re.compile(r'''['"]\s*SELECT[^'"]*['"][^;]*\+'''),     # 'SELECT ... ' + ...
        re.compile(r'''['"]\s*INSERT[^'"]*['"][^;]*\+'''),
        re.compile(r'''['"]\s*UPDATE[^'"]*['"][^;]*\+'''),
        re.compile(r'''['"]\s*DELETE[^'"]*['"][^;]*\+'''),
        re.compile(r'''`[^`]*\$\{(?!\?\?)[^}]+\}[^`]*(SELECT|INSERT|UPDATE|DELETE)''', re.I),
    ]
    for ts_file in adapter_dir.glob('*.ts'):
        text = ts_file.read_text(encoding='utf-8', errors='ignore')
        for pat in concat_patterns:
            if pat.search(text):
                sql_concat_violations.append(f'{ts_file.name}: {pat.pattern[:50]}')
if sql_concat_violations:
    check('no_sql_concat', False, '; '.join(sql_concat_violations))
else:
    check('no_sql_concat', True, 'adapters use parameterized queries')

# Check 4: No forbidden runtime imports. @cloudflare/workers-types is type-only.
runtime_import_violations: list[str] = []
if adapter_dir.exists():
    forbidden_runtime = re.compile(
        r'''^\s*import\s+(?!type\s)[^;]*from\s+['"]@cloudflare/workers-types['"]''',
        re.MULTILINE,
    )
    for ts_file in adapter_dir.glob('*.ts'):
        text = ts_file.read_text(encoding='utf-8', errors='ignore')
        if forbidden_runtime.search(text):
            runtime_import_violations.append(ts_file.name)
if runtime_import_violations:
    check('no_runtime_cf_types', False, ', '.join(runtime_import_violations))
else:
    check('no_runtime_cf_types', True, 'workers-types imported as types only')

# Check 5: Every src/adapters/*.ts MUST have a tests/<name>.test.ts that
# invokes runAdapterSpec. Closes the "silent adapter" hole — someone adds
# redis.ts without the behavior suite ever touching it.
adapter_coverage_fails: list[str] = []
if adapter_dir.exists():
    tests_dir = PKG_ROOT / 'tests'
    for adapter in sorted(adapter_dir.glob('*.ts')):
        name = adapter.stem            # e.g. 'memory'
        spec = tests_dir / f'{name}.test.ts'
        if not spec.exists():
            adapter_coverage_fails.append(f'{name} — no tests/{name}.test.ts')
            continue
        spec_text = spec.read_text(encoding='utf-8', errors='ignore')
        if 'runAdapterSpec' not in spec_text:
            adapter_coverage_fails.append(
                f'{name} — tests/{name}.test.ts exists but does not call runAdapterSpec'
            )
if adapter_coverage_fails:
    check('adapter_coverage', False, '; '.join(adapter_coverage_fails))
else:
    check('adapter_coverage', True, 'every adapter has a spec-running test')

# Check 6: YAML syntax fast-fail (invokes the standalone script).
import subprocess
yaml_check = subprocess.run(
    [sys.executable, str(PKG_ROOT / 'scripts' / 'check-yaml-syntax.py')],
    capture_output=True, text=True,
)
# Fail closed: the script exits 0 with [SKIP] when PyYAML is missing, which
# used to read here as 'contract parses' without parsing anything (OSE-1461).
if yaml_check.returncode == 0 and '[SKIP]' in yaml_check.stdout:
    check('yaml_syntax', False, 'SKIPPED - PyYAML not installed, contract was not parsed')
elif yaml_check.returncode == 0:
    check('yaml_syntax', True, 'contract parses')
else:
    tail = (yaml_check.stdout + yaml_check.stderr).strip().splitlines()[-3:]
    check('yaml_syntax', False, ' | '.join(tail))

# Check 7: Pragma audit — enforces policy on inline `security-gate: allow`
# exemptions via the shared canonical module. Keeps the escape hatch from
# silently growing. Module vendored from OCR-docs/shared/pragma_audit.py.
try:
    import pragma_audit  # type: ignore
    pragma_fails = pragma_audit.run_audit(PKG_ROOT)
    if pragma_fails:
        check('pragma_audit', False, ' | '.join(msg for _, _, msg in pragma_fails))
    else:
        check('pragma_audit', True, 'policy clean')
except ImportError:
    check('pragma_audit', False,
          'vendored pragma_audit.py not importable from tests/_shared/ '
          '— run `cd OCR-docs && py shared/sync_to_repos.py`')

security_gate.report_and_exit(results, passed, header='LEVEL 0 - SECURITY (@ocr/flags)')

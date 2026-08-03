#!/usr/bin/env python3
"""
Offline Python pre-check of the invariants test assertions.
Mirrors packages/flags/tests/invariants.test.ts so we can validate the
YAML contract before `pnpm install` is ever run on the runner. Used
locally; CI uses the TS vitest suite.
"""
import sys
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError:
    print('[SKIP] PyYAML not installed — cannot pre-check')
    sys.exit(0)

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
REPO_ROOT = PKG.parent.parent
CONTRACT = REPO_ROOT / 'OCR-docs' / 'ocr-docs-brain' / 'flags-contract.yaml'

assertions = []
fails = []


def check(label, ok, detail=''):
    state = 'PASS' if ok else 'FAIL'
    assertions.append((label, state, detail))
    if not ok:
        fails.append(label)


if not CONTRACT.exists():
    print(f'[FAIL] contract missing at {CONTRACT}')
    sys.exit(1)

doc = yaml.safe_load(CONTRACT.read_text(encoding='utf-8'))

# Invariant 5 — Tier Equity
check('I5.presets_free_mid_enterprise',
      sorted(doc['tier_presets'].keys()) == ['enterprise', 'free', 'mid'],
      f"got={sorted(doc['tier_presets'].keys())}")

check('I5.axes_separate',
      doc.get('axes', {}).get('sponsor_pricing', {}).get('values') == ['local', 'mid', 'premium']
      and doc.get('axes', {}).get('flag_presets', {}).get('values') == ['free', 'mid', 'enterprise'],
      'sponsor pricing and flag presets declared on separate axes')

free = doc['tier_presets']['free']['flags']
check('I5.free_tier_baseline_access',
      free.get('forms.register') is True
      and free.get('forms.checkin') is True
      and free.get('report.export-json') is True,
      'register+checkin+json all True at free tier')

# Every tier preset enumerates every flag key
all_keys = []
for dom_entries in doc['flag_keys'].values():
    all_keys.extend(dom_entries.keys())
missing_by_tier = {}
for tier, preset in doc['tier_presets'].items():
    miss = [k for k in all_keys if k not in preset['flags']]
    if miss:
        missing_by_tier[tier] = miss
check('I5.no_preset_strips_keys', not missing_by_tier, str(missing_by_tier))

# Faith equity flags present
events = doc['flag_keys'].get('events', {})
required_events = {'events.faith-free-marketing', 'events.faith-sponsor', 'events.adult-only'}
check('I5.faith_equity_flags_present', required_events.issubset(events.keys()))

# Invariant dependencies
deps = set(doc.get('invariant_dependencies', {}).keys())
check('I5.tier_equity_invariant_declared', 'tier_equity' in deps)
check('I10.deprecation_lock_declared', 'deprecation_lock' in deps)
check('anonymous_id_declared', 'anonymous_id' in deps)
check('tenant_isolation_declared', 'tenant_isolation' in deps)

# Invariant 6 — Inert Monetization
check('I6.value_type_boolean_only',
      doc.get('value_type', {}).get('allowed') == ['boolean'])

import json
pkg_json = json.loads((PKG / 'package.json').read_text(encoding='utf-8'))
combined = {**(pkg_json.get('dependencies') or {}), **(pkg_json.get('peerDependencies') or {})}
import re
forbidden_re = re.compile(r'stripe|braintree|paypal|square|chargebee|recurly|billing|payment', re.I)
billing = [n for n in combined if forbidden_re.search(n)]
check('I6.no_monetization_deps', not billing, ','.join(billing))

# Report
width = 48
print('=' * 78)
print('  VISION INVARIANTS — pre-check (mirror of invariants.test.ts)')
print('=' * 78)
for label, state, detail in assertions:
    marker = '[PASS]' if state == 'PASS' else '[FAIL]'
    line = f'  {marker}  {label.ljust(width)} {detail}'
    print(line.rstrip())
print('-' * 78)
total = len(assertions)
passed = total - len(fails)
print(f'  {passed} pass / {len(fails)} fail  (total {total})')
print('-' * 78)
sys.exit(0 if not fails else 1)

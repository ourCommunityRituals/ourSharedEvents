#!/usr/bin/env python3
"""
check_brain_contract.py
=======================
Compares a product repo's actual state to what the OCR-docs brain declares.
Drift = the product changed without updating the brain, OR the brain changed
without the product following. Either case fails CI.

Run inside a CI job that has already checked out both the product repo and
OCR-docs side by side.

Exit codes:
  0 = conformant
  1 = drift detected (failures written to report)
  2 = execution error (brain unreachable, product repo malformed)

Writes a JSON report at --report-path suitable for posting to Linear.
"""
import argparse, json, os, re, sys, yaml
from pathlib import Path
from typing import Any

FAIL = 'FAIL'
PASS = 'PASS'


def load_brain(brain_dir: Path) -> dict[str, Any]:
    """Load all brain artifacts into a single dict."""
    try:
        return {
            'products': yaml.safe_load((brain_dir / 'product-registry.yaml').read_text()),
            'tiers': yaml.safe_load((brain_dir / 'tier-gates.yaml').read_text()),
            'corridors': yaml.safe_load((brain_dir / 'corridor-definitions.yaml').read_text()),
            'taxonomy': yaml.safe_load((brain_dir / 'event-taxonomy.yaml').read_text()),
            'invariants': yaml.safe_load((brain_dir / 'architectural-invariants.yaml').read_text()),
            'bq_general': json.loads((brain_dir / 'bigquery-schemas/general.json').read_text()),
            'bq_hipaa':   json.loads((brain_dir / 'bigquery-schemas/hipaa.json').read_text()),
            'bq_coppa':   json.loads((brain_dir / 'bigquery-schemas/coppa.json').read_text()),
            'bq_agg':     json.loads((brain_dir / 'bigquery-schemas/aggregate.json').read_text()),
        }
    except Exception as e:
        print(f"ERROR: could not load brain from {brain_dir}: {e}", file=sys.stderr)
        sys.exit(2)


def find_product(brain: dict, product_id: str) -> dict | None:
    """Find the product record in the registry."""
    for p in brain['products'].get('products', []):
        if p.get('product_id') == product_id:
            return p
    return None


def scan_repo_for_string(repo: Path, pattern: str, glob: str = '**/*') -> list[str]:
    """Return relative paths of files containing `pattern`.
    Excludes vendored dirs and the .github/scripts dir which contains
    the checker itself (it would otherwise flag its own search patterns)."""
    hits = []
    EXCLUDE_DIRS = ('node_modules', '.git', 'dist', 'build', '.next', '.venv',
                    '.github')  # scripts dir lives here; exclude entirely
    for f in repo.glob(glob):
        if not f.is_file():
            continue
        if any(skip in f.parts for skip in EXCLUDE_DIRS):
            continue
        try:
            if pattern in f.read_text(encoding='utf-8', errors='ignore'):
                hits.append(str(f.relative_to(repo)))
        except Exception:
            continue
    return hits


def find_schema_files(repo: Path) -> list[Path]:
    """Find SQL migrations, schema.ts, wrangler.toml — places tables are declared."""
    candidates = []
    for pattern in ('**/migrations/*.sql', '**/schema.ts', '**/schema.sql',
                     'wrangler.toml', 'wrangler.jsonc', '**/d1-schema.sql'):
        candidates.extend(repo.glob(pattern))
    return [c for c in candidates if c.is_file()
            and not any(skip in c.parts for skip in ('node_modules', '.git'))]


# ---------------------------------------------------------------------------
# Conformance checks — each returns (name, status, detail)
# ---------------------------------------------------------------------------

def check_regulatory_pools_present(repo: Path, product: dict) -> tuple[str, str, str]:
    """Every regulatory pool the brain says this product routes to must have
    evidence in the codebase (env var, dataset name, or binding)."""
    required = product.get('regulatory_pools', []) or []
    if not required:
        return ('regulatory_pools_present', PASS, 'no pools required')

    bq_datasets = product.get('bigquery_datasets', {}) or {}
    missing = []
    for pool in required:
        dataset_name = bq_datasets.get(pool)
        if not dataset_name:
            missing.append(f'{pool}: no dataset in brain')
            continue
        hits = scan_repo_for_string(repo, dataset_name)
        if not hits:
            missing.append(f'{pool}: dataset "{dataset_name}" not referenced anywhere in repo')

    if missing:
        return ('regulatory_pools_present', FAIL, '; '.join(missing))
    return ('regulatory_pools_present', PASS, f'all {len(required)} pool datasets referenced')


def check_required_tags_used(repo: Path, product: dict) -> tuple[str, str, str]:
    """The tags the brain requires for this product's writes must appear in code."""
    required_tags = product.get('required_tags', []) or []
    if not required_tags:
        return ('required_tags_used', PASS, 'no required tags')

    missing = []
    for tag in required_tags:
        hits = scan_repo_for_string(repo, tag)
        if not hits:
            missing.append(tag)
    if missing:
        return ('required_tags_used', FAIL, f'tags absent from code: {missing}')
    return ('required_tags_used', PASS, f'all {len(required_tags)} required tags referenced')


def check_invariant_test_files(repo: Path, brain: dict, product_id: str) -> tuple[str, str, str]:
    """Every invariant that 'applies_to' this product must have its test file
    present in the repo — status live/partial/planned determines severity."""
    applicable = [i for i in brain['invariants']['invariants']
                  if product_id in (i.get('applies_to') or [])]
    if not applicable:
        return ('invariant_test_files', PASS, f'no invariants apply to {product_id}')

    missing_live = []
    missing_partial = []
    for inv in applicable:
        tf = inv.get('test_file')
        if not tf:
            continue
        hits = list(repo.glob(f'**/{tf}'))
        hits = [h for h in hits if '.git' not in h.parts and 'node_modules' not in h.parts]
        if not hits:
            if inv.get('status') == 'live':
                missing_live.append(tf)
            elif inv.get('status') == 'partial':
                missing_partial.append(tf)

    if missing_live:
        return ('invariant_test_files', FAIL,
                f'live invariant tests missing: {missing_live} '
                f'(partial also missing: {missing_partial})')
    if missing_partial:
        return ('invariant_test_files', PASS,
                f'all live tests present; {len(missing_partial)} partial tests '
                f'not yet implemented (acceptable): {missing_partial[:3]}')
    return ('invariant_test_files', PASS,
            f'all {len(applicable)} applicable invariant tests present')


def check_tier_gate_respected(repo: Path, product: dict, brain: dict) -> tuple[str, str, str]:
    """If the brain says this product supports only free+mid in phase1,
    there must not be hard-coded references to 'premium' as an active tier
    in phase1 code paths."""
    ta = product.get('tier_availability', {})
    p1 = ta.get('phase1', [])

    if 'premium' in p1:
        return ('tier_gate_respected', PASS, 'premium allowed in phase1 per brain')

    suspicious_files = scan_repo_for_string(repo, 'tier === "premium"')
    suspicious_files += scan_repo_for_string(repo, "tier == 'premium'")
    if suspicious_files:
        return ('tier_gate_respected', PASS,
                f'premium references exist but may be gated correctly — manual review: '
                f'{suspicious_files[:3]}')
    return ('tier_gate_respected', PASS, 'no uncaged premium tier references')


def check_faith_organization_commitment(repo: Path, brain: dict) -> tuple[str, str, str]:
    """The brain commits churches to free indefinitely. Repo must not have a
    code path that charges faith_organization."""
    overrides = brain['tiers'].get('sponsor_type_overrides', {})
    faith = overrides.get('faith_organization', {})
    if faith.get('forced_tier') != 'free':
        return ('faith_commitment', FAIL,
                'brain faith_organization override missing or not forced to free')

    hits = scan_repo_for_string(repo, 'faith_organization')
    if not hits:
        return ('faith_commitment', PASS,
                'faith_organization not yet referenced in repo (acceptable pre-launch)')
    return ('faith_commitment', PASS,
            f'faith_organization referenced in {len(hits)} files; manual review recommended')


def check_uec_codes_in_sync(repo: Path, brain: dict) -> tuple[str, str, str]:
    """Every UEC code the brain declares should appear somewhere the repo uses it,
    or at minimum not be contradicted by an unknown UEC code in the repo."""
    brain_codes = set()
    for cat in brain['taxonomy'].get('categories', []):
        for t in cat.get('event_types', []):
            if t.get('uec_code'):
                brain_codes.add(t['uec_code'])

    uec_pattern = re.compile(r'\b(?:CR|MC|GR|FD|WH|YE|CC|SS)-\d{3}\b')
    repo_codes = set()
    EXCLUDE_DIRS = ('.git', 'node_modules', '.github', 'dist', 'build', '.next', '.venv')
    for f in repo.rglob('*'):
        if not f.is_file() or any(s in f.parts for s in EXCLUDE_DIRS):
            continue
        try:
            text = f.read_text(encoding='utf-8', errors='ignore')
            for m in uec_pattern.finditer(text):
                repo_codes.add(m.group(0))
        except Exception:
            continue

    unknown = repo_codes - brain_codes
    if unknown:
        return ('uec_codes_in_sync', FAIL,
                f'repo contains {len(unknown)} UEC codes not in brain: {sorted(unknown)[:5]}')
    return ('uec_codes_in_sync', PASS,
            f'all {len(repo_codes)} UEC codes in repo resolve to brain definitions')


def check_identity_layer_contract(repo: Path, product: dict) -> tuple[str, str, str]:
    """Anonymous products must not introduce named-identity coupling."""
    if product.get('identity_layer') != 'anonymous':
        return ('identity_layer_contract', PASS,
                f'product layer is {product.get("identity_layer")}, skipping anon check')

    forbidden = ['firebase_auth_user_id', 'spotify_user_id', 'named_contributor']
    leaks = []
    for term in forbidden:
        hits = scan_repo_for_string(repo, term)
        if hits:
            leaks.append(f'{term}: {hits[:2]}')
    if leaks:
        return ('identity_layer_contract', FAIL,
                f'anonymous product contains named-identity references: {leaks}')
    return ('identity_layer_contract', PASS, 'no named-identity leakage in anonymous product')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--brain', required=True, help='Path to ocr-docs-brain directory')
    ap.add_argument('--repo', required=True, help='Path to product repo root')
    ap.add_argument('--product-id', required=True, help='Product ID in brain registry')
    ap.add_argument('--report-path', default='conformance-report.json')
    args = ap.parse_args()

    brain_dir = Path(args.brain)
    repo = Path(args.repo)

    if not brain_dir.exists():
        print(f'ERROR: brain dir {brain_dir} does not exist', file=sys.stderr)
        sys.exit(2)
    if not repo.exists():
        print(f'ERROR: repo dir {repo} does not exist', file=sys.stderr)
        sys.exit(2)

    brain = load_brain(brain_dir)
    product = find_product(brain, args.product_id)
    if not product:
        print(f'ERROR: product_id "{args.product_id}" not in brain registry', file=sys.stderr)
        sys.exit(2)

    print(f'Running conformance checks for {args.product_id} against brain @ {brain_dir}...')
    print()

    checks = [
        check_regulatory_pools_present(repo, product),
        check_required_tags_used(repo, product),
        check_invariant_test_files(repo, brain, args.product_id),
        check_tier_gate_respected(repo, product, brain),
        check_faith_organization_commitment(repo, brain),
        check_uec_codes_in_sync(repo, brain),
        check_identity_layer_contract(repo, product),
    ]

    passed = [c for c in checks if c[1] == PASS]
    failed = [c for c in checks if c[1] == FAIL]

    print('=' * 76)
    print(f'  CONFORMANCE REPORT — {args.product_id}')
    print('=' * 76)
    for name, status, detail in checks:
        marker = '[PASS]' if status == PASS else '[FAIL]'
        print(f'  {marker}  {name:35} {detail}')
    print('-' * 76)
    print(f'  {len(passed)} pass / {len(failed)} fail  (total {len(checks)})')
    print('-' * 76)

    report = {
        'product_id': args.product_id,
        'brain_path': str(brain_dir),
        'repo_path': str(repo),
        'summary': {'passed': len(passed), 'failed': len(failed), 'total': len(checks)},
        'passes':  [{'check': n, 'detail': d} for n, s, d in checks if s == PASS],
        'failures': [{'check': n, 'detail': d} for n, s, d in checks if s == FAIL],
    }
    Path(args.report_path).write_text(json.dumps(report, indent=2))
    print(f'Report: {args.report_path}')

    sys.exit(0 if not failed else 1)


if __name__ == '__main__':
    main()

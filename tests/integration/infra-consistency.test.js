/**
 * Infrastructure Consistency Tests
 *
 * Validates:
 * 1. CLOUDFLARE_API_TOKEN_OSE naming is consistent (no stale references)
 * 2. Secret config files align with GitHub Secrets
 * 3. D1 staging databases have expected tables and seed data
 *
 * Run: npm run test:infra
 */

const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..');

function grep(pattern, path, opts = '') {
  try {
    const result = execSync(
      `grep -r "${pattern}" "${path}" ${opts} --include="*.yml" --include="*.yaml" --include="*.js" --include="*.ts" --include="*.json" --include="*.sh" --include="*.toml" 2>/dev/null || true`,
      { encoding: 'utf-8', cwd: ROOT }
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function readJSON(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf-8'));
}

function readFile(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf-8');
}

// ─── Token Naming Consistency ────────────────────────────────────────

describe('CLOUDFLARE_API_TOKEN_OSE naming consistency', () => {
  test('no stale secrets.CLOUDFLARE_API_TOKEN references in workflows', () => {
    // The env var name CLOUDFLARE_API_TOKEN is correct (wrangler expects it).
    // Only flag references to the OLD secret name (secrets.CLOUDFLARE_API_TOKEN without _ESE).
    const hits = grep('secrets\\.CLOUDFLARE_API_TOKEN[^_]', '.github/workflows/', '-l');
    expect(hits).toEqual([]);
  });

  test('no stale CLOUDFLARE_API_TOKEN references in scripts/', () => {
    // Scripts reference the env var name, which should be _ESE for config alignment
    const hits = grep("'CLOUDFLARE_API_TOKEN'", 'scripts/', '-l');
    expect(hits).toEqual([]);
  });

  test('no stale CLOUDFLARE_API_TOKEN in .github-secrets-required.json', () => {
    const config = readJSON('.github-secrets-required.json');
    const names = config.stage1.required.map((s) => s.name);
    expect(names).not.toContain('CLOUDFLARE_API_TOKEN');
  });

  test('no stale CLOUDFLARE_API_TOKEN in wrangler.toml', () => {
    const content = readFile('workers/oursharedevents/wrangler.toml');
    // wrangler.toml should not reference the token name at all (account_id is separate)
    expect(content).not.toMatch(/CLOUDFLARE_API_TOKEN/);
  });

  test('CI workflow sources from secrets.CLOUDFLARE_API_TOKEN_OSE', () => {
    const content = readFile('.github/workflows/oursharedevents-ci.yml');
    expect(content).toContain('secrets.CLOUDFLARE_API_TOKEN_OSE');
    // Env var must be CLOUDFLARE_API_TOKEN (wrangler expects this name)
    // sourced from the _OSE secret
    expect(content).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN_OSE }}');
  });
});

// ─── Secret Config Alignment ─────────────────────────────────────────

describe('Secret config alignment', () => {
  test('.github-secrets-required.json declares CLOUDFLARE_API_TOKEN_OSE', () => {
    const config = readJSON('.github-secrets-required.json');
    const stage1Names = config.stage1.required.map((s) => s.name);
    expect(stage1Names).toContain('CLOUDFLARE_API_TOKEN_OSE');
    expect(stage1Names).not.toContain('CLOUDFLARE_API_TOKEN');
  });

  test('validate-ci-secrets.js checks CLOUDFLARE_API_TOKEN_OSE', () => {
    const content = readFile('scripts/validate-ci-secrets.js');
    expect(content).toContain("name: 'CLOUDFLARE_API_TOKEN_OSE'");
    expect(content).toContain("env: 'CLOUDFLARE_API_TOKEN_OSE'");
  });

  test('verify-secrets.js checks CLOUDFLARE_API_TOKEN_OSE', () => {
    const content = readFile('scripts/verify-secrets.js');
    expect(content).toContain("name: 'CLOUDFLARE_API_TOKEN_OSE'");
    expect(content).toContain("env: 'CLOUDFLARE_API_TOKEN_OSE'");
  });

  test('wrangler.toml has account_id set', () => {
    const content = readFile('workers/oursharedevents/wrangler.toml');
    expect(content).toMatch(/^account_id\s*=/m);
  });
});

// ─── D1 Staging Database Health ──────────────────────────────────────

const D1_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN_OSE;
const MAIN_DB_ID = '4c4381db-3823-412d-8275-e35d80e603b4';
const FORMS_DB_ID = 'ff1cb46d-cb3b-463d-9aad-713de4d272b5';

const canQueryD1 = Boolean(D1_ACCOUNT_ID && D1_API_TOKEN);

async function queryD1(dbId, sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${D1_ACCOUNT_ID}/d1/database/${dbId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${D1_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  return data.result[0].results;
}

describe('D1 staging database health', () => {
  const EXPECTED_MAIN_TABLES = [
    'events',
    'sponsors',
    'poster_deployments',
    'scans',
    'scan_aggregates',
    'subscribers',
    'event_templates',
  ];

  const EXPECTED_FORMS_TABLES = [
    'form_registrations',
    'checkin_counts',
    'form_surveys',
    'email_signups',
    'feature_flags',
    'pii_audit_log',
  ];

  test.skipIf(!canQueryD1)('ocr-db-staging has core tables', async () => {
    const rows = await queryD1(
      MAIN_DB_ID,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' AND name != 'sqlite_sequence' ORDER BY name"
    );
    const tables = rows.map((r) => r.name);
    for (const t of EXPECTED_MAIN_TABLES) {
      expect(tables, `missing table: ${t}`).toContain(t);
    }
  });

  test.skipIf(!canQueryD1)('ocr-forms-db-staging has form tables', async () => {
    const rows = await queryD1(
      FORMS_DB_ID,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' AND name != 'sqlite_sequence' ORDER BY name"
    );
    const tables = rows.map((r) => r.name);
    for (const t of EXPECTED_FORMS_TABLES) {
      expect(tables, `missing table: ${t}`).toContain(t);
    }
  });

  test.skipIf(!canQueryD1)('event_templates are seeded (>0 rows)', async () => {
    const rows = await queryD1(MAIN_DB_ID, 'SELECT COUNT(*) as count FROM event_templates');
    expect(rows[0].count).toBeGreaterThan(0);
  });

  test.skipIf(!canQueryD1)('feature_flags are seeded (>0 rows)', async () => {
    const rows = await queryD1(FORMS_DB_ID, 'SELECT COUNT(*) as count FROM feature_flags');
    expect(rows[0].count).toBeGreaterThan(0);
  });
});

// ─── npm audit resilience — @ocr/flags SBOM mutation guards (PR #254) ──────────
//
// The S0 Security job's "Fix @ocr/flags for SBOM resolution" step strips
// devDependencies from node_modules/@ocr/flags/package.json IN PLACE so
// CycloneDX SBOM only inventories prod deps. Self-hosted runners persist
// node_modules between runs. Without guards, a subsequent run honors the
// install-stamp (keyed only on package-lock.json hash, unchanged), skips
// `npm ci`, and `npm audit` submits the mutated tree to the npm registry —
// which rejects it with `400 — Invalid package tree`.
//
// Two guards prevent this. These tests lock both so a future workflow edit
// can't silently remove them (the failure mode is sporadic — only when a
// runner happens to carry mutated state — so it would not be caught
// deterministically by CI execution alone).
describe('npm audit resilience — @ocr/flags SBOM mutation guards', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const s0Steps = (wf.jobs && wf.jobs.security && wf.jobs.security.steps) || [];
  const installStep = s0Steps.find((s) => s && s.name === 'Install dependencies');
  const sbomFixStep = s0Steps.find((s) => s && s.name === 'Fix @ocr/flags for SBOM resolution');

  test('S0 Security job has the "Install dependencies" step', () => {
    expect(installStep, 'security job must have an "Install dependencies" step').toBeDefined();
  });

  test('S0 Security job has the "Fix @ocr/flags for SBOM resolution" step', () => {
    expect(
      sbomFixStep,
      'security job must have the "Fix @ocr/flags for SBOM resolution" step'
    ).toBeDefined();
  });

  test('GUARD 1 (self-healing): Install step detects a mutated @ocr/flags and forces fresh npm ci', () => {
    const run = (installStep && installStep.run) || '';
    // The detection must compute a flags_mutated signal...
    expect(run, 'install step must compute a flags_mutated signal').toMatch(/flags_mutated/);
    // ...by inspecting @ocr/flags devDependencies...
    expect(
      run,
      'install step must inspect @ocr/flags devDependencies to detect the SBOM mutation'
    ).toMatch(/devDependencies/);
    // ...AND the skip-npm-ci condition MUST actually consult flags_mutated.
    // If the detection is computed but the skip condition ignores it, the
    // guard is dead code and npm audit will still hit the mutated tree.
    expect(
      run,
      'the skip-npm-ci condition MUST gate on flags_mutated=false — otherwise the detection is computed but never used'
    ).toMatch(/flags_mutated"?\s*=\s*'false'/);
  });

  test('GUARD 2 (belt-and-suspenders): SBOM fix step invalidates the install stamp', () => {
    const run = (sbomFixStep && sbomFixStep.run) || '';
    expect(
      run,
      'the SBOM @ocr/flags fix step must `rm -f node_modules/.install-stamp` so the next run reinstalls against the canonical lockfile-derived tree'
    ).toMatch(/rm\s+-f\s+node_modules\/\.install-stamp/);
  });
});

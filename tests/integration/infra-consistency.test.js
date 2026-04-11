/**
 * Infrastructure Consistency Tests
 *
 * Validates:
 * 1. CLOUDFLARE_API_TOKEN_ESE naming is consistent (no stale references)
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

describe('CLOUDFLARE_API_TOKEN_ESE naming consistency', () => {
  test('no stale CLOUDFLARE_API_TOKEN references in workflows', () => {
    const hits = grep('CLOUDFLARE_API_TOKEN[^_]', '.github/workflows/', '-l');
    expect(hits).toEqual([]);
  });

  test('no stale CLOUDFLARE_API_TOKEN references in scripts/', () => {
    const hits = grep('CLOUDFLARE_API_TOKEN[^_]', 'scripts/', '-l');
    expect(hits).toEqual([]);
  });

  test('no stale CLOUDFLARE_API_TOKEN in .github-secrets-required.json', () => {
    const content = readFile('.github-secrets-required.json');
    const staleMatches = content.match(/CLOUDFLARE_API_TOKEN[^_]/g);
    expect(staleMatches).toBeNull();
  });

  test('no stale CLOUDFLARE_API_TOKEN in wrangler.toml', () => {
    const content = readFile('workers/oursharedevents/wrangler.toml');
    const staleMatches = content.match(/CLOUDFLARE_API_TOKEN[^_]/g);
    expect(staleMatches).toBeNull();
  });

  test('CLOUDFLARE_API_TOKEN_ESE exists in active CI workflow', () => {
    const content = readFile('.github/workflows/oursharedevents-ci.yml');
    expect(content).toContain('CLOUDFLARE_API_TOKEN_ESE');
    expect(content).toContain('secrets.CLOUDFLARE_API_TOKEN_ESE');
  });
});

// ─── Secret Config Alignment ─────────────────────────────────────────

describe('Secret config alignment', () => {
  test('.github-secrets-required.json declares CLOUDFLARE_API_TOKEN_ESE', () => {
    const config = readJSON('.github-secrets-required.json');
    const stage1Names = config.stage1.required.map((s) => s.name);
    expect(stage1Names).toContain('CLOUDFLARE_API_TOKEN_ESE');
    expect(stage1Names).not.toContain('CLOUDFLARE_API_TOKEN');
  });

  test('validate-ci-secrets.js checks CLOUDFLARE_API_TOKEN_ESE', () => {
    const content = readFile('scripts/validate-ci-secrets.js');
    expect(content).toContain("name: 'CLOUDFLARE_API_TOKEN_ESE'");
    expect(content).toContain("env: 'CLOUDFLARE_API_TOKEN_ESE'");
  });

  test('verify-secrets.js checks CLOUDFLARE_API_TOKEN_ESE', () => {
    const content = readFile('scripts/verify-secrets.js');
    expect(content).toContain("name: 'CLOUDFLARE_API_TOKEN_ESE'");
    expect(content).toContain("env: 'CLOUDFLARE_API_TOKEN_ESE'");
  });

  test('wrangler.toml has account_id set', () => {
    const content = readFile('workers/oursharedevents/wrangler.toml');
    expect(content).toMatch(/^account_id\s*=/m);
  });
});

// ─── D1 Staging Database Health ──────────────────────────────────────

const D1_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN_ESE;
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

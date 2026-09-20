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
  // Paths are repository-relative test fixtures, resolved beneath ROOT.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf-8'));
}

function readFile(relPath) {
  // Paths are repository-relative test fixtures, resolved beneath ROOT.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(join(ROOT, relPath), 'utf-8');
}

// ─── Hosted runner migration — production jobs (OSE-1257) ───────────

describe('production jobs use hosted runners', () => {
  test('no workflow job targets the retired self-hosted runner pool', () => {
    const yaml = require('js-yaml');
    const { readdirSync } = require('fs');
    const workflowsDir = join(ROOT, '.github', 'workflows');
    const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.(yml|yaml)$/.test(file));

    for (const file of workflowFiles) {
      const workflow = yaml.load(readFile(`.github/workflows/${file}`)) || {};
      for (const [jobId, job] of Object.entries(workflow.jobs || {})) {
        const runner = job && job['runs-on'];
        const labels = Array.isArray(runner) ? runner : [runner];
        expect(
          labels,
          `${file}:${jobId} must not target the retired self-hosted runner pool`
        ).not.toContain('self-hosted');
      }
    }
  });

  test('deploy-production and smoke-production use ubuntu-latest', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    expect(workflow.jobs['deploy-production']['runs-on']).toBe('ubuntu-latest');
    expect(workflow.jobs['smoke-production']['runs-on']).toBe('ubuntu-latest');
  });

  test('deploy-production requires the staging chain to be green first', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    expect(workflow.jobs['deploy-production'].needs).toEqual(
      expect.arrayContaining([
        'security',
        'gate',
        'deploy-staging',
        'smoke-staging',
        'contract-staging',
        'functional-staging',
      ])
    );
  });

  test('staging and production deploys verify canonical D1 table and column shape', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    const stagingVerify = workflow.jobs['deploy-staging'].steps.find((step) =>
      step.name?.includes('Verify staging D1')
    );
    const productionVerify = workflow.jobs['deploy-production'].steps.find((step) =>
      step.name?.includes('Verify production D1')
    );

    expect(stagingVerify?.run).toBe('node scripts/verify-d1-canonical-shape.mjs --env staging');
    expect(productionVerify?.run).toBe(
      'node scripts/verify-d1-canonical-shape.mjs --env production'
    );
  });
});

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

// ─── Invariant enforcement continuity — structural specs gate T0 (OSE-350) ────
//
// The 0-architecture invariant suite is the brain's "CI-enforced architectural
// contracts" layer. Before OSE-350 the WHOLE suite ran only in dispatch-only
// T4 Functional — so a PR could break an invariant's code shape and nothing
// caught it on the normal PR/push path. OSE-350 added a T0 Gate `invariants`
// shard that runs the STRUCTURAL subset (specs that read source via node:fs,
// no deployed worker needed) on every PR + push.
//
// This placement guard locks the continuity. It classifies every spec in
// tests/e2e/0-architecture/ as structural or runtime by inspecting content,
// then asserts every structural spec is wired into the T0 step. A new
// structural invariant spec that is NOT listed in the workflow fails here —
// so the enforcement continuity cannot silently regress (the exact failure
// mode PR #59's defects pointed at).
// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT SHARD PLACEMENT GUARD (2026-09-01)
//
// Same class of guard as the invariants one below, for the same reason. The
// component shard runs viewport/layout specs against a LOCAL worker
// (playwright.component.config.ts, `wrangler dev --local`) — the first tier
// that executes real FE flows on a PR. Before it existed, 55 surface specs
// were named in zero workflows, so the failure mode is proven: a Playwright
// spec that no workflow names runs nowhere and nobody notices.
//
// Without this guard the shard could be dropped from the matrix, or its batch
// emptied, and every check would stay green while FE coverage silently went
// back to zero.
describe('component tier continuity — the component shard gates T0', () => {
  const yaml = require('js-yaml');
  const { existsSync } = require('fs');

  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const gate = (wf.jobs && wf.jobs.gate) || {};
  const shards = (gate.strategy && gate.strategy.matrix && gate.strategy.matrix.shard) || [];
  const step = (gate.steps || []).find(
    (s) => s && s.name === 'Component: viewport specs vs local worker'
  );
  const run = (step && step.run) || '';
  // Spec paths named on the command line — the batch this tier actually runs.
  const named = run.match(/tests\/e2e\/[\w/-]+\.spec\.ts/g) || [];

  test('T0 Gate matrix includes the component shard', () => {
    expect(
      shards,
      'gate job matrix must include a "component" shard so FE viewport specs run on every PR/push'
    ).toContain('component');
  });

  test('the component step exists', () => {
    expect(
      step,
      'gate job must have the "Component: viewport specs vs local worker" step'
    ).toBeDefined();
  });

  test('playwright.component.config.ts exists and starts a local worker', () => {
    expect(existsSync(join(ROOT, 'playwright.component.config.ts'))).toBe(true);
    const cfg = readFile('playwright.component.config.ts');
    expect(
      /webServer/.test(cfg),
      'the component config must define a webServer — without it the tier points at a deployed URL and inherits the staging dependency it exists to avoid'
    ).toBe(true);
    expect(
      /wrangler dev/.test(cfg),
      'the component webServer must start a local worker (wrangler dev)'
    ).toBe(true);
  });

  test('the component step names at least one spec (an empty batch must not pass)', () => {
    expect(
      named.length,
      'the component step runs no specs — an empty batch would report green while testing nothing'
    ).toBeGreaterThan(0);
  });

  test('every spec named in the component step exists on disk', () => {
    for (const spec of named) {
      // Specs are discovered from this repository's workflow configuration.
      expect(
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        existsSync(join(ROOT, spec)),
        `component step names ${spec}, which does not exist — the batch would fail to discover it`
      ).toBe(true);
    }
  });
});

describe('invariant enforcement continuity — structural specs gate T0 (OSE-350)', () => {
  const yaml = require('js-yaml');
  const { readdirSync } = require('fs');

  const ARCH_REL = 'tests/e2e/0-architecture';
  const specs = readdirSync(join(ROOT, ARCH_REL)).filter((f) => f.endsWith('.invariant.spec.ts'));

  // Classify each spec by content. Runtime = needs a deployed worker
  // (page fixture / request fixture / baseURL). Structural = reads source
  // files via node:fs and asserts code shape, no worker needed.
  const classified = specs.map((spec) => {
    const content = readFile(`${ARCH_REL}/${spec}`);
    const isRuntime =
      /page\.goto|\{\s*page\s*\}|\{\s*request\s*\}|\brequest\.(get|post|fetch)\b|baseURL/.test(
        content
      );
    const isStructural = /readFileSync|existsSync/.test(content) && !isRuntime;
    return { spec, isRuntime, isStructural };
  });
  const structural = classified.filter((c) => c.isStructural).map((c) => c.spec);
  const runtime = classified.filter((c) => c.isRuntime).map((c) => c.spec);

  // The T0 Gate "Architecture: structural invariants" step.
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const gateSteps = (wf.jobs && wf.jobs.gate && wf.jobs.gate.steps) || [];
  const invStep = gateSteps.find((s) => s && s.name === 'Architecture: structural invariants');
  const invRun = (invStep && invStep.run) || '';
  const matrixShards =
    (wf.jobs &&
      wf.jobs.gate &&
      wf.jobs.gate.strategy &&
      wf.jobs.gate.strategy.matrix &&
      wf.jobs.gate.strategy.matrix.shard) ||
    [];

  test('T0 Gate matrix includes the invariants shard', () => {
    expect(
      matrixShards,
      'gate job matrix must include an "invariants" shard so structural invariants run on every PR/push'
    ).toContain('invariants');
  });

  test('T0 Gate has the "Architecture: structural invariants" step', () => {
    expect(
      invStep,
      'gate job must have the "Architecture: structural invariants" step'
    ).toBeDefined();
  });

  test('every 0-architecture spec classifies as structural OR runtime (no unknowns)', () => {
    const unknown = classified.filter((c) => !c.isStructural && !c.isRuntime).map((c) => c.spec);
    expect(
      unknown,
      `specs that classify as neither structural nor runtime — the classifier or the spec needs attention: ${unknown.join(', ')}`
    ).toEqual([]);
  });

  test('EVERY structural invariant spec is wired into the T0 gating path', () => {
    expect(structural.length, 'expected ≥1 structural invariant spec').toBeGreaterThan(0);
    for (const spec of structural) {
      expect(
        invRun.includes(spec),
        `structural invariant ${spec} is NOT in the T0 "Architecture: structural invariants" step — it would run only in dispatch-only T4, breaking enforcement continuity. Add it to that step's file list in oursharedevents-ci.yml.`
      ).toBe(true);
    }
  });

  test('NO runtime invariant spec is in the T0 structural step', () => {
    for (const spec of runtime) {
      expect(
        invRun.includes(spec),
        `runtime invariant ${spec} is listed in the T0 structural step but needs a deployed worker — T0 runs pre-deploy, so it would fail there. Runtime invariants belong in T4/post-deploy tiers.`
      ).toBe(false);
    }
  });
});

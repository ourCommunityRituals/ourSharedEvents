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

// ─── Hosted runner migration — staging pattern applied to prod (OSE-1257) ───

describe('OSE-1257 hosted runner migration mirrors staging into production', () => {
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

  // OSE-1408: `ubuntu-latest` re-points to Ubuntu 26 on 2026-10-19, five days
  // before the Oct 24 launch. Every job pins the image so a runner-image change
  // lands as a reviewed PR, never as a surprise mid-deploy-window. Un-pinning
  // (or moving to ubuntu-26.04) is a deliberate post-launch change to this value.
  const PINNED_RUNNER = 'ubuntu-24.04';

  test('every workflow job pins the hosted runner image (no floating ubuntu-latest)', () => {
    const yaml = require('js-yaml');
    const { readdirSync } = require('fs');
    const workflowsDir = join(ROOT, '.github', 'workflows');
    const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.(yml|yaml)$/.test(file));

    let jobsChecked = 0;
    for (const file of workflowFiles) {
      const workflow = yaml.load(readFile(`.github/workflows/${file}`)) || {};
      for (const [jobId, job] of Object.entries(workflow.jobs || {})) {
        // Reusable-workflow callers (`uses:`) have no runs-on of their own.
        if (!job || job.uses) continue;
        jobsChecked += 1;
        expect(job['runs-on'], `${file}:${jobId} must pin ${PINNED_RUNNER}`).toBe(PINNED_RUNNER);
      }
    }
    expect(jobsChecked).toBeGreaterThan(0);
  });

  test('staging and production deploy/smoke jobs use the same pinned hosted runner', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    expect(workflow.jobs['deploy-staging']['runs-on']).toBe(PINNED_RUNNER);
    expect(workflow.jobs['contract-staging-sub']['runs-on']).toBe(PINNED_RUNNER);
    expect(workflow.jobs['smoke-staging-sub']['runs-on']).toBe(PINNED_RUNNER);
    expect(workflow.jobs['functional-staging-sub']['runs-on']).toBe(PINNED_RUNNER);
    expect(workflow.jobs['functional-staging']['runs-on']).toBe(PINNED_RUNNER);
    expect(workflow.jobs['deploy-production']['runs-on']).toBe(PINNED_RUNNER);
    expect(workflow.jobs['smoke-production']['runs-on']).toBe(PINNED_RUNNER);
  });

  // ADR-008 Phase 0: the staging step stages the hub commit pinned in
  // .ocr-hub-ref and @ocr/ui is REQUIRED for any job that builds the Worker.
  const STAGE_STEP = 'Stage pinned hub packages (@ocr/ui required, @ocr/flags) @ .ocr-hub-ref';

  test('deploy-production mirrors the hosted staging deploy setup', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
    const stagingSteps = workflow.jobs['deploy-staging'].steps;
    const productionSteps = workflow.jobs['deploy-production'].steps;
    const findStep = (steps, name) => steps.find((step) => step.name === name);
    const checkoutStep = (steps) => steps.find((step) => step.uses === 'actions/checkout@v7');
    const deployPrereqs = [
      STAGE_STEP,
      'Install worker dependencies',
      'Gate: required secrets present (pre-migrate, fail-closed corner) (OSE-1343)',
      'Apply D1 migrations (main DB)',
      'Apply D1 migrations (forms DB)',
      'Gate: no unprovisioned binding IDs (OSE-813)',
      'Gate: zero unapplied D1 migrations before deploy (OSE-803)',
      'Stamp build version',
      'Deploy',
      'Wait + Health check',
    ];

    for (const stepName of deployPrereqs) {
      expect(findStep(stagingSteps, stepName), `staging has ${stepName}`).toBeTruthy();
      expect(
        findStep(productionSteps, stepName),
        `production mirrors staging ${stepName}`
      ).toBeTruthy();
    }

    expect(checkoutStep(stagingSteps).with).toMatchObject({ clean: true });
    expect(checkoutStep(productionSteps).with).toMatchObject({ clean: true });
    expect(findStep(stagingSteps, STAGE_STEP).run).toBe(findStep(productionSteps, STAGE_STEP).run);
    // @ocr/ui is bundled into the Worker: a deploy must never proceed past a
    // failed pinned-hub staging step.
    expect(findStep(stagingSteps, STAGE_STEP)['continue-on-error']).toBeUndefined();
    expect(findStep(productionSteps, STAGE_STEP)['continue-on-error']).toBeUndefined();
    expect(findStep(stagingSteps, 'Install worker dependencies').run).toBe(
      findStep(productionSteps, 'Install worker dependencies').run
    );
    expect(findStep(stagingSteps, 'Gate: no unprovisioned binding IDs (OSE-813)').run).toBe(
      findStep(productionSteps, 'Gate: no unprovisioned binding IDs (OSE-813)').run
    );
  });

  test('every job that stages @ocr/flags preserves the adjacent workspace checkout', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    for (const [jobId, job] of Object.entries(workflow.jobs || {})) {
      const steps = job.steps || [];
      const stagesAdjacentFlags = steps.some((step) => step.name === STAGE_STEP);
      if (!stagesAdjacentFlags) continue;
      const checkout = steps.find((step) => step.uses === 'actions/checkout@v7');
      expect(checkout?.with, `${jobId} must use hosted-runner clean:true checkout`).toMatchObject({
        clean: true,
      });
    }
  });

  test('deploy-production requires the staging chain to be green first', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    expect(workflow.jobs['deploy-staging'].if).toContain(
      "(github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v'))"
    );
    expect(workflow.jobs['deploy-staging'].if).toContain(
      "(github.event_name == 'workflow_dispatch' && github.event.inputs.deploy_production == 'PRODUCTION')"
    );
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

  test('staging and production deploys both enforce the schema guard before deploy', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    const zeroGate = (jobName) =>
      workflow.jobs[jobName].steps.find(
        (step) => step.name === 'Gate: zero unapplied D1 migrations before deploy (OSE-803)'
      );
    const stagingGate = zeroGate('deploy-staging');
    const productionGate = zeroGate('deploy-production');

    expect(stagingGate?.run).toContain('node scripts/check-schema-guard.mjs');
    expect(productionGate?.run).toContain('node scripts/check-schema-guard.mjs');
    expect(stagingGate?.run).toContain('--env staging --remote');
    expect(productionGate?.run).toContain('--env production --remote');
    expect(stagingGate?.run).toContain('for BINDING in DB FORMS_DB');
    expect(productionGate?.run).toContain('for BINDING in DB FORMS_DB');
  });

  test('T0 lint runs the OSE-802 column type collision guard', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
    const lintJob = workflow.jobs.gate.steps.find(
      (step) => step.name === 'Security: Column type collision guard (OSE-802)'
    );

    expect(lintJob).toMatchObject({
      if: "matrix.shard == 'lint'",
      'working-directory': '${{ env.WORKER_DIR }}',
      run: 'node scripts/check-column-type-collisions.mjs',
    });
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

  // ─── Required-secret presence gate — staging pattern applied to prod (OSE-1343) ───
  //
  // OSE-1343's staging 503 traced to FORMS_HASH_PEPPER: unset, it made register +
  // email-signup throw and surface as a masked DB_ERROR. The code fix (#565) made
  // that a clear CONFIG_ERROR, but the pre-migrate presence gate only ever checked
  // SHARED_REPORT_SIGNING_SECRET, and set-secrets.sh's required list never included
  // FORMS_HASH_PEPPER — so neither staging nor production would have been stopped
  // pre-deploy. Both are fixed here, mirrored across environments.
  test('staging and production pre-migrate gates require FORMS_HASH_PEPPER (OSE-1343)', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

    const secretGate = (jobName) =>
      workflow.jobs[jobName].steps.find(
        (step) =>
          step.name ===
          'Gate: required secrets present (pre-migrate, fail-closed corner) (OSE-1343)'
      );
    const stagingGate = secretGate('deploy-staging');
    const productionGate = secretGate('deploy-production');

    for (const gate of [stagingGate, productionGate]) {
      expect(gate?.run).toContain('SHARED_REPORT_SIGNING_SECRET');
      expect(gate?.run).toContain('FORMS_ENCRYPTION_KEY');
      expect(gate?.run).toContain('FORMS_HASH_PEPPER');
      expect(gate?.run).toContain('RATE_LIMIT_KEY_PEPPER');
    }
    expect(stagingGate?.run).toContain('--env staging');
    expect(productionGate?.run).toContain('--env production');
  });

  test('set-secrets.sh provisions FORMS_HASH_PEPPER alongside the other required secrets (OSE-1343)', () => {
    const script = readFile('scripts/set-secrets.sh');
    expect(script).toMatch(
      /SECRETS=\(\s*\n\s*"FORMS_ENCRYPTION_KEY"\s*\n\s*"FORMS_HASH_PEPPER"\s*\n\s*"SHARED_REPORT_SIGNING_SECRET"\s*\n\s*"RATE_LIMIT_KEY_PEPPER"\s*\n\s*"ANON_ID_HASH_PEPPER"\s*\n\s*\)/
    );
  });

  // OSE-1659: the scan id is keyed with ANON_ID_HASH_PEPPER. It was never in the
  // provisioning list, so nothing prompted for it. A missing value warns at deploy
  // (scans keep counting, with no id) rather than failing it.
  test('both deploy gates warn when ANON_ID_HASH_PEPPER is missing (OSE-1659)', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
    for (const job of ['deploy-staging', 'deploy-production']) {
      const gate = workflow.jobs[job].steps.find(
        (step) =>
          step.name ===
          'Gate: required secrets present (pre-migrate, fail-closed corner) (OSE-1343)'
      );
      expect(gate?.run, job).toMatch(/grep -q "ANON_ID_HASH_PEPPER"/);
      expect(gate?.run, job).toMatch(/::warning title=ANON_ID_HASH_PEPPER missing::/);
    }
  });

  // ADR-012 gate R2 (OSE-1467): production admin is Cloudflare Access only.
  test('set-secrets.sh provisions ADMIN_KEY for staging only', () => {
    const script = readFile('scripts/set-secrets.sh');
    expect(script).toMatch(
      /if \[\[ "\$ENV" == "staging" \]\]; then\s*\n\s*SECRETS=\("ADMIN_KEY" "\$\{SECRETS\[@\]\}"\)/
    );
  });

  test('the production deploy gate refuses static admin credentials', () => {
    const ci = readFile('.github/workflows/oursharedevents-ci.yml');
    const gate = ci.slice(ci.indexOf('--env production 2>&1'));
    expect(gate).toMatch(/for SECRET in ADMIN_KEY X_OCR_INTERNAL ADMIN_TOKEN; do/);
    expect(gate).toMatch(/is set on the production worker/);
  });
});

// ─── Bruno contract budgets ───────────────────────────────────────────

// ─── No Postman/Newman left in the repo ──────────────────────────────

// OSE-1191 moved the contract from Newman to Bruno, but postman/ lived on as a
// home for staging SQL seeds the Bruno run depends on. Every test asset and
// every piece of infra the contract needs lives under bruno/ now (collections,
// and bruno/fixtures/ for the D1 seeds T2 applies). Archived history stays in
// archive/; this only guards the live tree.
describe('Postman is gone: tests and infra live under bruno/', () => {
  const { existsSync, readdirSync } = require('fs');

  test('there is no postman/ directory', () => {
    expect(existsSync(join(ROOT, 'postman'))).toBe(false);
  });

  const workflows = () =>
    readdirSync(join(ROOT, '.github/workflows'))
      .filter((n) => /\.ya?ml$/.test(n))
      .map((n) => ({ name: n, text: readFile(`.github/workflows/${n}`) }));

  test('no workflow refers to postman/', () => {
    const offenders = workflows()
      // A path, not prose: "Postman/Newman" in a comment or issue title is history.
      .filter((w) => /(^|[^A-Za-z])postman\//.test(w.text))
      .map((w) => w.name);
    expect(offenders).toEqual([]);
  });

  test('every D1 seed a workflow applies is a bruno/fixtures/ file that exists', () => {
    const seeds = [];
    for (const w of workflows()) {
      for (const m of w.text.matchAll(/--file\s+(?:\.\.\/)+(\S+\.sql)/g)) seeds.push(m[1]);
    }
    expect(seeds.length).toBeGreaterThan(0);
    const misplaced = seeds.filter(
      (p) => !p.startsWith('bruno/fixtures/') && !p.startsWith('tests/')
    );
    expect(misplaced).toEqual([]);
    expect(seeds.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });
});

describe('Bruno contract latency budgets', () => {
  test('admin registrations read has an explicit decrypted-list budget', () => {
    const collection = readFile('bruno/ose-api/opencollection.yml');

    expect(collection).toContain('const isAdminRegistrationsRead');
    expect(collection).toContain("req.getPath().includes('/forms/registrations')");
    expect(collection).toContain('Response time < 9000ms');
    expect(collection).toContain('expect(elapsed).to.be.below(9000)');
    expect(collection).toContain('Response time < 6000ms');
    expect(collection).toContain('expect(elapsed).to.be.below(6000)');
  });

  // Bruno strips comments with `decomment`, which picks ONE line ending for the
  // whole merged script by majority vote. The ex-Newman conversion left the
  // collection-level script CRLF, so it outvoted every short LF request script
  // and each `// comment` swallowed everything up to the next CRLF — request
  // assertions (and the latency budget above) silently never ran while the
  // requests still reported PASS. Found in CCR PR 700. One ending everywhere.
  test('no Bruno script carries a carriage return (decomment would eat assertions)', () => {
    const yaml = require('js-yaml');
    const { readdirSync, statSync } = require('fs');
    const walk = (dir) =>
      readdirSync(join(ROOT, dir)).flatMap((name) => {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel);
        return rel.endsWith('.yml') ? [rel] : [];
      });
    const offenders = [];
    const collect = (node, file) => {
      if (Array.isArray(node)) node.forEach((n) => collect(n, file));
      else if (node && typeof node === 'object') {
        if (typeof node.code === 'string' && node.code.includes('\r')) offenders.push(file);
        Object.values(node).forEach((n) => collect(n, file));
      }
    };
    const files = walk('bruno');
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) collect(yaml.load(readFile(f)), f);
    expect(offenders).toEqual([]);
  });

  test('the latency budget is real code, not folded into a comment line', () => {
    const yaml = require('js-yaml');
    const doc = yaml.load(readFile('bruno/ose-api/opencollection.yml'));
    const post = doc.request.scripts.find((s) => s.type === 'after-response').code;
    const lines = post.split('\n').map((l) => l.trim());
    expect(lines).toContain('if (isAdminRegistrationsRead) {');
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
  const advisoryWf = yaml.load(readFile('.github/workflows/advanced-security-scan.yml'));
  const s0Steps = (wf.jobs && wf.jobs.security && wf.jobs.security.steps) || [];
  const advisorySbomSteps =
    (advisoryWf.jobs && advisoryWf.jobs.sbom && advisoryWf.jobs.sbom.steps) || [];
  const installStep = s0Steps.find((s) => s && s.name === 'Install dependencies');
  const sbomFixStep = s0Steps.find((s) => s && s.name === 'Fix @ocr/flags for SBOM resolution');
  const advisoryGenerateSbomStep = advisorySbomSteps.find(
    (s) => s && s.name === 'Generate CycloneDX SBOM'
  );

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

  test('advisory SBOM tolerates managed-runner @ocr/flags npm-ls noise', () => {
    const run = (advisoryGenerateSbomStep && advisoryGenerateSbomStep.run) || '';
    expect(
      run,
      'advanced-security-scan SBOM must match S0 managed-runner tolerance for @ocr/flags file: deps'
    ).toContain('--ignore-npm-errors');
  });
});

// ─── T4d admin gate continuity — scoped worker-401 smoke (OSE-311) ───────────
describe('T4d smoke exercises the admin sign-in worker gate', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const smokeSteps =
    (wf.jobs && wf.jobs['functional-staging-sub'] && wf.jobs['functional-staging-sub'].steps) || [];
  const tier1Step = smokeSteps.find((s) => s && s.name === 'T4d: UI Smoke — Tier-1 page smoke');
  const run = (tier1Step && tier1Step.run) || '';

  test('T4d Tier-1 smoke step exists', () => {
    expect(
      tier1Step,
      'functional-staging-sub must include the T4d Tier-1 smoke step'
    ).toBeDefined();
  });

  test('T4d no longer grep-inverts the admin sign-in route', () => {
    expect(
      run,
      'admin sign-in must remain in blocking T4d smoke; it uses a scoped CF Access context to reach worker 401'
    ).not.toMatch(/grep-invert[^\n]*admin sign-in/);
  });

  test('T4d still grep-inverts shared report until signed-link smoke is wired', () => {
    expect(
      run,
      'shared report shell still needs a signed-link token before joining blocking T4d'
    ).toMatch(/grep-invert[^\n]*shared report shell/);
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

describe('T0 test sub-gates remain split and aggregated', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const gate = (wf.jobs && wf.jobs.gate) || {};
  const gateShards = (gate.strategy && gate.strategy.matrix && gate.strategy.matrix.shard) || [];
  const testSubGate = (wf.jobs && wf.jobs['gate-tests-sub']) || {};
  const testAggregate = (wf.jobs && wf.jobs['gate-tests']) || {};
  const testSubGateSteps = testSubGate.steps || [];
  const workerDepsStep = testSubGateSteps.find(
    (s) => s && s.name === 'Install worker dependencies'
  );
  const sections =
    (testSubGate.strategy &&
      testSubGate.strategy.matrix &&
      testSubGate.strategy.matrix.include &&
      testSubGate.strategy.matrix.include.map((entry) => entry.section)) ||
    [];

  test('monolithic tests shard is not in the generic T0 matrix', () => {
    expect(
      gateShards,
      'T0 tests must stay decomposed into named sub-gates instead of returning to one long-pole shard'
    ).not.toContain('tests');
  });

  test('T0 test sub-gate matrix covers each bounded section', () => {
    expect(sections).toEqual(
      expect.arrayContaining([
        'security-iac',
        'root-vitest',
        'ui-drift',
        'worker-d1-schema',
        'launch-contracts',
      ])
    );
  });

  test('required-check-compatible T0 Gate (tests) aggregate depends on the sub-gates', () => {
    expect(testAggregate.name).toBe('T0 Gate (tests)');
    expect(testAggregate.needs).toEqual(expect.arrayContaining(['gate-tests-sub']));
  });

  test('worker-dependent sub-gates (worker-d1-schema, launch-contracts) install worker dependencies before running', () => {
    // OSE-1364 added a second workers/oursharedevents-workdir section
    // (launch-contracts) alongside worker-d1-schema; both need the worker's
    // own node_modules installed, so the gate is keyed on matrix.workdir
    // rather than a single hardcoded matrix.section value.
    expect(
      workerDepsStep,
      'a workers/oursharedevents-workdir sub-gate must install worker dependencies'
    ).toBeDefined();
    expect(workerDepsStep.if).toBe("matrix.workdir == 'workers/oursharedevents'");
    expect(workerDepsStep['working-directory']).toBe('${{ env.WORKER_DIR }}');
  });

  test('staging deploy waits for the test aggregate', () => {
    expect(wf.jobs['deploy-staging'].needs).toEqual(expect.arrayContaining(['gate-tests']));
  });
});

describe('T3 smoke sub-gates remain split and aggregated', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const smokeSubGate = (wf.jobs && wf.jobs['smoke-staging-sub']) || {};
  const smokeAggregate = (wf.jobs && wf.jobs['smoke-staging']) || {};
  const sections =
    (smokeSubGate.strategy &&
      smokeSubGate.strategy.matrix &&
      smokeSubGate.strategy.matrix.include &&
      smokeSubGate.strategy.matrix.include.map((entry) => entry.section)) ||
    [];

  test('T3 smoke sub-gate matrix covers each bounded smoke section', () => {
    expect(sections).toEqual(expect.arrayContaining(['security', 'iac', 'forms']));
  });

  test('required-check-compatible T3 aggregate depends on the sub-gates', () => {
    expect(smokeAggregate.name).toBe('T3 E2E Smoke → Staging (Playwright)');
    expect(smokeAggregate.needs).toEqual(expect.arrayContaining(['smoke-staging-sub']));
  });

  test('functional staging waits for the T3 aggregate, not raw sub-gates', () => {
    expect(wf.jobs['functional-staging-sub'].needs).toEqual(
      expect.arrayContaining(['smoke-staging'])
    );
    expect(wf.jobs['functional-staging-sub'].needs).not.toContain('smoke-staging-sub');
  });
});

describe('T2 contract sub-gates remain split and aggregated', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const contractSubGate = (wf.jobs && wf.jobs['contract-staging-sub']) || {};
  const contractAggregate = (wf.jobs && wf.jobs['contract-staging']) || {};
  const sections =
    (contractSubGate.strategy &&
      contractSubGate.strategy.matrix &&
      contractSubGate.strategy.matrix.include &&
      contractSubGate.strategy.matrix.include.map((entry) => entry.section)) ||
    [];
  const subSteps = contractSubGate.steps || [];
  const apiOnlySteps = subSteps.filter((step) => step && step.if === "matrix.section == 'api'");

  test('T2 contract sub-gate matrix covers API and Pages collections', () => {
    expect(sections).toEqual(expect.arrayContaining(['api', 'pages']));
  });

  test('required-check-compatible T2 aggregate depends on the sub-gates', () => {
    expect(contractAggregate.name).toBe('T2 Contract → Staging (Bruno)');
    expect(contractAggregate.needs).toEqual(expect.arrayContaining(['contract-staging-sub']));
  });

  test('API-only staging fixture setup does not run in the Pages sub-gate', () => {
    expect(
      apiOnlySteps.map((step) => step.name),
      'CF Access preflight and remote D1 fixture setup should stay scoped to the API contract'
    ).toEqual(
      expect.arrayContaining([
        'CF Access preflight probe',
        'Seed covenant event geo (OSE-891 fixture)',
        'Reset covenant/journey sponsor fixtures (OSE-944 — prevent accumulation)',
        'Seed covenant sponsors accepted (CCR-PR567 fixture)',
      ])
    );
  });

  test('T3 smoke waits for the T2 aggregate, not raw sub-gates', () => {
    expect(wf.jobs['smoke-staging-sub'].needs).toEqual(
      expect.arrayContaining(['contract-staging'])
    );
    expect(wf.jobs['smoke-staging-sub'].needs).not.toContain('contract-staging-sub');
  });
});

// ─── Playwright browser cache continuity — staging/PR CI speed (OSE-1073/1074) ───
describe('Playwright browser installs use cache on staging and PR gates', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));

  const stepIndex = (steps, name) => steps.findIndex((step) => step && step.name === name);
  const assertCacheStep = (steps, name, expectedIf) => {
    const cacheStep = steps.find((step) => step && step.name === name);
    expect(cacheStep, `${name} step must exist`).toBeDefined();
    expect(cacheStep.uses).toBe('actions/cache@v6');
    expect(cacheStep.with && cacheStep.with.path).toBe('~/.cache/ms-playwright');
    expect(cacheStep.with && cacheStep.with.key).toContain('playwright');
    if (expectedIf) expect(cacheStep.if).toBe(expectedIf);
  };

  test('T0 browser shards restore the Playwright cache before inline installs', () => {
    const steps = wf.jobs.gate.steps || [];
    assertCacheStep(
      steps,
      'Restore Playwright browser cache',
      "matrix.shard == 'invariants' || matrix.shard == 'component'"
    );

    const cachePos = stepIndex(steps, 'Restore Playwright browser cache');
    const archPos = stepIndex(steps, 'Architecture: structural invariants');
    const componentPos = stepIndex(steps, 'Component: viewport specs vs local worker');
    expect(cachePos).toBeGreaterThanOrEqual(0);
    expect(cachePos).toBeLessThan(archPos);
    expect(cachePos).toBeLessThan(componentPos);
  });

  test('T3 smoke restores the Playwright cache before installing Chromium', () => {
    const steps = wf.jobs['smoke-staging-sub'].steps || [];
    assertCacheStep(steps, 'Restore Playwright browser cache', 'matrix.installBrowser == true');
    expect(stepIndex(steps, 'Restore Playwright browser cache')).toBeLessThan(
      stepIndex(steps, 'Install Playwright browsers')
    );
  });

  test('T4 functional restores the Playwright cache before installing browser engines', () => {
    const steps = wf.jobs['functional-staging-sub'].steps || [];
    assertCacheStep(steps, 'Restore Playwright browser cache');
    expect(stepIndex(steps, 'Restore Playwright browser cache')).toBeLessThan(
      stepIndex(steps, 'Install Playwright browsers')
    );
  });
});

// ─── npm cache continuity — hosted runner CI speed (OSE-1073/1074) ─────────────
describe('main CI setup-node steps cache npm downloads', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
  const setupNodeSteps = Object.entries(wf.jobs || {}).flatMap(([jobId, job]) =>
    (job.steps || [])
      .filter((step) => step && step.uses === 'actions/setup-node@v7')
      .map((step) => ({ jobId, step }))
  );

  test('the workflow has setup-node steps to guard', () => {
    expect(setupNodeSteps.length).toBeGreaterThan(0);
  });

  test('every setup-node step enables npm cache for root and worker lockfiles', () => {
    for (const { jobId, step } of setupNodeSteps) {
      expect(step.with && step.with.cache, `${jobId} setup-node must enable npm cache`).toBe('npm');
      const dependencyPath = step.with && step.with['cache-dependency-path'];
      expect(dependencyPath, `${jobId} setup-node must key cache on both npm lockfiles`).toContain(
        'package-lock.json'
      );
      expect(dependencyPath, `${jobId} setup-node must include the worker npm lockfile`).toContain(
        'workers/oursharedevents/package-lock.json'
      );
    }
  });
});

describe('invariant enforcement continuity — structural specs gate T0 (OSE-350)', () => {
  const yaml = require('js-yaml');
  const { readdirSync } = require('fs');

  const ARCH_REL = 'tests/e2e/0-architecture';
  // `.invariant.test.ts` too: a brain invariant that lives in two repos names one
  // test_file for both, and ourWKRP's convention is `.test.ts` (#29).
  const specs = readdirSync(join(ROOT, ARCH_REL)).filter((f) =>
    /\.invariant\.(spec|test)\.ts$/.test(f)
  );

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

  // T4a (post-deploy) runs exactly the runtime set (OSE-1507). Structural
  // specs already gated T0 on the same SHA, so re-running them after deploy
  // adds no signal; a runtime spec missing here would never run at all.
  const t4aRun = (() => {
    const wf = yaml.load(readFile('.github/workflows/oursharedevents-ci.yml'));
    for (const job of Object.values(wf.jobs || {})) {
      const st = (job.steps || []).find((s) => s && s.name === 'T4a: Architecture Invariants');
      if (st) return String(st.run || '');
    }
    return '';
  })();

  test('T4a runs every runtime invariant and no structural one', () => {
    expect(t4aRun, 'T4a step must exist').not.toBe('');
    expect(runtime.length, 'expected ≥1 runtime invariant spec').toBeGreaterThan(0);
    expect(t4aRun, 'T4a must name files, not the whole directory').not.toMatch(
      /0-architecture\/(\s|\\|$)/
    );
    for (const spec of runtime) {
      expect(t4aRun.includes(spec), `runtime invariant ${spec} must run in T4a`).toBe(true);
    }
    for (const spec of structural) {
      expect(
        t4aRun.includes(spec),
        `structural invariant ${spec} already gates T0; do not re-run it in T4a`
      ).toBe(false);
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

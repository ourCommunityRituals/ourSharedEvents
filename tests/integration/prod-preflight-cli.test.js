/**
 * Production preflight, run as the founder runs it.
 *
 * tests/unit/ci/prod-preflight.test.js holds each check on fixtures. This file
 * holds the parts a unit test cannot:
 *   1. the command itself, on this checkout, with input files in a temp folder
 *      (nothing is fetched; no wrangler, no gh);
 *   2. the lists the script compares against are the same ones the deploy job
 *      uses, read from the workflow, so the two cannot drift apart.
 */

const { execFileSync, spawnSync } = require('child_process');
const { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WORKER = join(ROOT, 'workers', 'oursharedevents');
const SCRIPT = join(ROOT, 'scripts', 'prod-preflight.mjs');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const ci = yaml.load(read('.github/workflows/oursharedevents-ci.yml'));

const SHA = 'abc1234def5678abc1234def5678abc1234def56';
// Production's level when the plan was written: main 77, forms 14.
const PROD_DB_LEVEL = 77;
const PROD_FORMS_LEVEL = 14;

const migrations = (dir) =>
  readdirSync(join(WORKER, dir))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
const above = (dir, level) => migrations(dir).filter((f) => parseInt(f.slice(0, 4), 10) > level);
const pendingList = (names) =>
  `Migrations to be applied:\n${names.map((n) => `| ${n} |`).join('\n')}\n`;

let pf;
let dir;

beforeAll(async () => {
  pf = await import('../../scripts/prod-preflight.mjs');
});

/** A complete, good set of operator files. Each test then breaks one. */
function goodInputs() {
  return {
    'secrets.txt': JSON.stringify(
      pf.REQUIRED_SECRETS.map((name) => ({ name, type: 'secret_text' }))
    ),
    'migrations-db.txt': pendingList(above('migrations', PROD_DB_LEVEL)),
    'migrations-forms.txt': pendingList(above('migrations-forms', PROD_FORMS_LEVEL)),
    'staging-run.json': JSON.stringify({
      headSha: SHA,
      headBranch: 'main',
      event: 'push',
      conclusion: 'success',
      jobs: pf.STAGING_JOBS.map((name) => ({ name, conclusion: 'success' })),
    }),
    'access-canary.json': JSON.stringify({
      conclusion: 'success',
      jobs: [{ name: pf.ACCESS_CANARY_JOB, conclusion: 'success' }],
    }),
  };
}

function run(inputs, extraArgs = []) {
  for (const f of readdirSync(dir)) rmSync(join(dir, f));
  for (const [name, content] of Object.entries(inputs)) writeFileSync(join(dir, name), content);
  const r = spawnSync(process.execPath, [SCRIPT, '--inputs', dir, '--sha', SHA, ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the preflight command on this checkout', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'prod-preflight-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('the repo checks pass on main as it is (exit 0)', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--repo-only'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout).toContain('READY: all 5 checks passed.');
    expect(r.status).toBe(0);
  });

  test('with every input file good, it says READY and exits 0', () => {
    const r = run(goodInputs());
    expect(r.out).toContain('READY: all 11 checks passed.');
    expect(r.out).toContain(`production DB is at ${PROD_DB_LEVEL}`);
    expect(r.out).toContain(`production FORMS_DB is at ${PROD_FORMS_LEVEL}`);
    expect(r.code).toBe(0);
  });

  test('it names the migrations that write or remove rows', () => {
    const r = run(goodInputs());
    for (const file of [
      '0081_sponsor_tier_and_compact_logo.sql',
      '0082_poster_deployments_add_placement_type.sql',
      '0086_remove_seed_test_event.sql',
      '0088_admin_audit_log_brand_id.sql',
      '0089_clear_visitor_country.sql',
      '0016_scrub_raw_anonymous_id.sql',
    ]) {
      expect(r.out, file).toContain(`${file} (`);
    }
  });

  test('with no input files, every operator check is TODO and it exits 1', () => {
    const r = run({});
    expect(r.out).toContain('NOT READY: 0 failed, 6 not checked.');
    expect(r.code).toBe(1);
  });

  test.each([
    'secrets.txt',
    'migrations-db.txt',
    'migrations-forms.txt',
    'staging-run.json',
    'access-canary.json',
  ])('fault: %s is missing, so it is not ready', (name) => {
    const inputs = goodInputs();
    delete inputs[name];
    const r = run(inputs);
    expect(r.out).toContain('NOT READY');
    expect(r.out).toContain('TODO  ');
    expect(r.code).toBe(1);
  });

  test('fault: a static admin credential is set on production', () => {
    const inputs = goodInputs();
    inputs['secrets.txt'] = JSON.stringify([
      ...JSON.parse(inputs['secrets.txt']),
      { name: 'ADMIN_KEY' },
    ]);
    const r = run(inputs);
    expect(r.out).toContain(
      'FAIL  Production secrets (names only): set but must not be: ADMIN_KEY'
    );
    expect(r.out).toContain('npx wrangler secret delete ADMIN_KEY --env production');
    expect(r.code).toBe(1);
  });

  test('fault: production skipped an older migration', () => {
    const inputs = goodInputs();
    const older = migrations('migrations').find((f) => f.startsWith('0050'));
    inputs['migrations-db.txt'] = pendingList([older, ...above('migrations', PROD_DB_LEVEL)]);
    const r = run(inputs);
    expect(r.out).toContain('FAIL  Migrations production DB still has to apply');
    expect(r.out).toContain('not judged');
    expect(r.code).toBe(1);
  });

  test('fault: the green run is for another commit', () => {
    const inputs = goodInputs();
    inputs['staging-run.json'] = inputs['staging-run.json'].replace(
      SHA,
      'fff9999fff9999fff9999fff9999fff9999fff999'
    );
    const bad = run(inputs);
    expect(bad.out).toContain('FAIL  The staging chain is green for this commit');
    expect(bad.code).toBe(1);
  });

  test('files saved by Windows PowerShell (UTF-16) are read the same', () => {
    const inputs = goodInputs();
    for (const name of Object.keys(inputs)) {
      inputs[name] = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(inputs[name], 'utf16le'),
      ]);
    }
    const r = run(inputs);
    expect(r.out).toContain('READY: all 11 checks passed.');
    expect(r.code).toBe(0);
  });

  test('the output never holds a backslash path, on Windows or Linux', () => {
    expect(run({}).out).not.toContain(String.fromCharCode(92));
  });

  test('the script never fetches, spawns wrangler or gh, or reads the environment for a credential', () => {
    const src = read('scripts/prod-preflight.mjs');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/node:https?|node:net/);
    // The only command it runs is `git rev-parse HEAD`.
    expect(
      [...src.matchAll(/execFileSync\(\s*'([^']+)',\s*\[([^\]]*)\]/g)].map((m) => `${m[1]} ${m[2]}`)
    ).toEqual(["git 'rev-parse', 'HEAD'"]);
    expect(src.match(/execFileSync\(/g)).toHaveLength(1);
    expect(src.match(/from 'node:child_process'/g)).toHaveLength(1);
    expect(src).toContain("import { execFileSync } from 'node:child_process';");
  });

  test('the folder for operator files is ignored by git', () => {
    const ignored = execFileSync('git', ['check-ignore', `${pf.INPUT_DIR}/secrets.txt`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(ignored.trim()).toBe(`${pf.INPUT_DIR}/secrets.txt`);
  });
});

describe('the preflight compares against what the deploy job itself uses', () => {
  const prodSteps = ci.jobs['deploy-production'].steps;
  const gate = prodSteps.find((s) => String(s.name).startsWith('Gate: required secrets present'));
  const loops = [...String(gate.run).matchAll(/for SECRET in ([A-Z0-9_ ]+); do/g)].map((m) =>
    m[1].trim().split(/\s+/)
  );

  test('the required secret names are the deploy gate’s list', () => {
    expect(loops).toHaveLength(2);
    expect([...pf.REQUIRED_SECRETS].sort()).toEqual([...loops[0]].sort());
  });

  test('the forbidden secret names are the deploy gate’s list', () => {
    expect([...pf.FORBIDDEN_SECRETS].sort()).toEqual([...loops[1]].sort());
  });

  test('the staging stages are the jobs the production deploy waits for', () => {
    const waited = ['deploy-staging', 'contract-staging', 'smoke-staging', 'functional-staging'];
    expect(ci.jobs['deploy-production'].needs).toEqual(expect.arrayContaining(waited));
    expect([...pf.STAGING_JOBS].sort()).toEqual(waited.map((id) => ci.jobs[id].name).sort());
  });

  test('the Access canary job name is the one the canary workflow prints for production', () => {
    const canary = yaml.load(read('.github/workflows/cf-access-canary.yml'));
    const job = canary.jobs['access-app-routing'];
    const targets = job.strategy.matrix.include.map((m) => m.target);
    expect(targets).toContain('production');
    expect(job.name.replace('${{ matrix.target }}', 'production')).toBe(pf.ACCESS_CANARY_JOB);
  });

  test('the build stamp check looks for the line the deploy step rewrites', () => {
    const stamp = prodSteps.find((s) => s.name === 'Stamp build version');
    expect(stamp.run).toContain(
      'sed -i "s/WORKER_BUILD_VERSION = \\"prod-.*\\"/WORKER_BUILD_VERSION = \\"$VERSION\\"/" wrangler.toml'
    );
    expect(stamp.run).toContain('VERSION="prod-${SHORT_SHA}-$(date -u +%Y%m%d)"');
  });

  test('the production dataset and Worker name are the ones the code and config use', () => {
    expect(read('workers/oursharedevents/src/cloud/config.ts')).toContain(
      `export const PRODUCTION_BACKUP_DATASET = '${pf.PRODUCTION_BACKUP_DATASET}';`
    );
    expect(ci.env.PROD_BASE_URL).toBe(`https://${pf.PRODUCTION_HOST}`);
  });

  test('the staging-only settings are the ones the Worker’s own config test keeps off production', () => {
    const spec = read('workers/oursharedevents/tests/prod-admin-scope-config.spec.ts');
    for (const name of pf.STAGING_ONLY_VARS) expect(spec, name).toContain(name);
  });
});

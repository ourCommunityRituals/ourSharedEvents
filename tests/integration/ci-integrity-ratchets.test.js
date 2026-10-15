/**
 * CI integrity ratchets (OSE-1606): continue-on-error steps, skipped tests and
 * orphan tests/e2e specs may only shrink. Baseline: .ci-integrity-baseline.json.
 *
 * 1. The real tree matches its baseline exactly (a new one fails; a fixed one
 *    fails until the baseline is lowered, so the gain is locked in).
 * 2. Every baseline entry carries a real reason.
 * 3. The baseline cannot exceed the base branch's copy (when origin/main has one;
 *    a local convenience only, since a shallow CI checkout has no origin/main).
 * 4. Hermetic born-red cases: a throwaway tree with a baseline, then one injected
 *    continue-on-error / skip / orphan spec each turn the script red.
 * 5. CI wiring (OSE-1691): the T0 lint shard runs this script with
 *    --base-config, blocking. Before OSE-1691 nothing in CI ran it, and (3)
 *    returned early in CI, so a raised baseline passed every check (#933).
 * 6. Token split (OSE-1695): seven directional measurements from the shared
 *    enumerator scripts/ci/hub-token-wiring.mjs, born red below on a fixture tree.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'ci-integrity-ratchets.mjs');
const BASELINE = '.ci-integrity-baseline.json';
const TOKEN_KEYS = [
  'readUsesOnNewSecret',
  'writeUsesOnNewSecret',
  'writeSitesInMainAutomation',
  'bareOldTokenUses',
  'fallbackUses',
  'writeUsesOnWrongToken',
  'unrecognizedTokenForms',
];

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf-8' });
}

function put(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

describe('CI integrity ratchets (OSE-1606): the real tree', () => {
  test('counts equal the committed baseline', () => {
    const r = run(ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ci-integrity ratchets ok');
  });

  test('every baseline entry has a real reason', () => {
    const b = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf-8'));
    const entries = [
      ...Object.values(b.continueOnError.byFile),
      ...Object.values(b.skipsUnconditional.byFile),
      ...Object.values(b.skipsConditional.byFile),
      ...b.orphanSpecs.files,
      // Token split (OSE-1695): each key, every per-file entry and every retired site.
      ...TOKEN_KEYS.map((k) => b[k]),
      ...TOKEN_KEYS.flatMap((k) => Object.values(b[k].byFile)),
      ...TOKEN_KEYS.flatMap((k) => b[k].retired || []),
    ];
    expect(entries.length).toBeGreaterThan(0);
    for (const k of TOKEN_KEYS) expect(['up', 'down'], k).toContain(b[k].direction);
    for (const e of entries) {
      expect(typeof e.reason).toBe('string');
      expect(e.reason.length).toBeGreaterThan(15);
      expect(e.reason).not.toMatch(/^TODO/);
    }
  });

  test('baseline does not exceed the base branch copy (when one is reachable)', () => {
    const show = spawnSync('git', ['show', `origin/main:${BASELINE}`], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    // No origin/main here (a shallow CI checkout, a fresh clone): nothing to
    // compare locally. CI's own comparison is the lint-shard step, held in
    // place by "the lint shard runs the ratchet against the base branch" below.
    if (show.status !== 0) return;
    const baseFile = join(mkdtempSync(join(tmpdir(), 'ci-int-base-')), 'base.json');
    writeFileSync(baseFile, show.stdout);
    const r = run(ROOT, '--base-config', baseFile);
    expect(r.stderr).not.toContain('baseline raised');
    // Token split: a down-only ceiling may not rise, an up-only floor may not fall.
    expect(r.stderr).not.toContain('committed ceiling');
    expect(r.stderr).not.toContain('committed floor');
  });

  test('the lint shard runs the ratchet against the base branch, blocking (OSE-1691)', () => {
    const yaml = require('js-yaml');
    const wf = yaml.load(
      readFileSync(join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'), 'utf-8')
    );
    const hits = [];
    for (const [name, job] of Object.entries(wf.jobs || {})) {
      for (const s of job.steps || []) {
        if (/scripts\/ci\/ci-integrity-ratchets\.mjs/.test(String(s.run || ''))) {
          hits.push({ name, job, s });
        }
      }
    }
    expect(hits.length, 'a CI step runs ci-integrity-ratchets.mjs').toBeGreaterThanOrEqual(1);
    const { name, job, s } = hits[0];
    const run = String(s.run);
    expect(s.if, `${name}: runs in the lint shard`).toMatch(/matrix\.shard == 'lint'/);
    expect(run, `${name}: compares with the base branch's baseline`).toMatch(
      /--base-config "\$RUNNER_TEMP\/base-ci-integrity\.json"/
    );
    expect(run, `${name}: reads the base copy of the baseline`).toContain(
      'FETCH_HEAD:.ci-integrity-baseline.json'
    );
    expect(s['continue-on-error'], `${name}: blocking`).toBeUndefined();
    expect(job['continue-on-error'], `${name}: job is blocking`).toBeUndefined();
  });
});

describe('CI integrity ratchets (OSE-1606): born-red on injected faults', () => {
  let root;
  const WF = '.github/workflows/ci.yml';
  const CLEAN_WF = 'jobs:\n  a:\n    steps:\n      - name: x\n        run: echo hi\n';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ci-int-'));
    put(root, WF, CLEAN_WF + '            tests/e2e/1-smoke/named.spec.ts\n');
    put(root, 'tests/e2e/1-smoke/named.spec.ts', "test('a', () => {});\n");
    put(root, 'tests/unit/a.test.js', "test('a', () => {});\n");
    expect(run(root, '--update').status).toBe(0);
    expect(run(root).status).toBe(0); // green baseline before any fault
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a new continue-on-error step is red', () => {
    put(
      root,
      WF,
      CLEAN_WF + '        continue-on-error: true\n            tests/e2e/1-smoke/named.spec.ts\n'
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/continueOnError: 1 > baseline 0/);
  });

  test('a comment mentioning continue-on-error is not counted', () => {
    put(
      root,
      WF,
      // The comment sits after the scalar so the fixture stays valid YAML: the token-split
      // measurements parse every workflow, and an unparseable one is red.
      CLEAN_WF +
        '            tests/e2e/1-smoke/named.spec.ts\n      # never continue-on-error: true here\n'
    );
    expect(run(root).status).toBe(0);
  });

  test('a new unconditional skip is red', () => {
    put(root, 'tests/unit/a.test.js', "test.skip('a', () => {});\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/skipsUnconditional: 1 > baseline 0/);
  });

  test('a new conditional skip is red', () => {
    put(
      root,
      'tests/unit/a.test.js',
      "test('a', ({}, ti) => { test.skip(!process.env.X, 'no X'); });\n"
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/skipsConditional: 1 > baseline 0/);
  });

  test('xit / xdescribe count as skips', () => {
    put(root, 'tests/unit/a.test.js', "xit('a', () => {});\nxdescribe('b', () => {});\n");
    expect(run(root).stderr).toMatch(/skipsUnconditional: 2 > baseline 0/);
  });

  test('a new orphan e2e spec is red', () => {
    put(root, 'tests/e2e/3-flows/unnamed.spec.ts', "test('a', () => {});\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/orphanSpecs: 1 > baseline 0/);
  });

  test('naming a spec in a workflow (path, dir prefix or glob) is not an orphan', () => {
    put(root, 'tests/e2e/3-flows/b.spec.ts', "test('a', () => {});\n");
    put(root, 'tests/e2e/2-pages/form-x.spec.ts', "test('a', () => {});\n");
    put(root, 'tests/e2e/0-architecture/c.spec.ts', "test('a', () => {});\n");
    put(
      root,
      WF,
      CLEAN_WF +
        '            tests/e2e/3-flows/b.spec.ts tests/e2e/2-pages/form-*.spec.ts tests/e2e/0-architecture/ tests/e2e/1-smoke/named.spec.ts\n'
    );
    expect(run(root).status).toBe(0);
  });

  test('a shrunk count is red until the baseline is lowered', () => {
    put(
      root,
      WF,
      CLEAN_WF + '        continue-on-error: true\n            tests/e2e/1-smoke/named.spec.ts\n'
    );
    expect(run(root, '--update').status).toBe(0); // baseline now 1
    put(root, WF, CLEAN_WF + '            tests/e2e/1-smoke/named.spec.ts\n'); // fixed, baseline not lowered
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/continueOnError: 0 < baseline 1.*lower/);
  });

  test('a swap at equal totals (one fixed, one added) is red', () => {
    put(root, 'tests/unit/a.test.js', "test.skip('a', () => {});\n");
    expect(run(root, '--update').status).toBe(0);
    put(root, 'tests/unit/a.test.js', "test('a', () => {});\n");
    put(root, 'tests/unit/b.test.js', "test.skip('b', () => {});\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/b\.test\.js has 1, baseline 0/);
  });

  test('a baseline raised above the base branch copy is red', () => {
    put(root, 'tests/unit/a.test.js', "test.skip('a', () => {});\n");
    const lowBase = join(root, 'base.json');
    writeFileSync(lowBase, readFileSync(join(root, BASELINE), 'utf-8')); // base had 0 skips
    expect(run(root, '--update').status).toBe(0); // baseline raised to 1
    const r = run(root, '--base-config', lowBase);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/baseline raised to 1 above the base branch's 0/);
  });
});

// Token split (OSE-1695): directional ratchets on the shared enumerator
// (scripts/ci/hub-token-wiring.mjs). UP-ONLY: readUsesOnNewSecret, writeUsesOnNewSecret,
// writeSitesInMainAutomation. DOWN-ONLY: bareOldTokenUses, fallbackUses,
// writeUsesOnWrongToken, unrecognizedTokenForms.
// The fixture mirrors main: three staging steps and one OCR-docs checkout on
// OCR_HUB_READ alone (no fallback), and the two named write sites, each on its own
// token, still on its `NEW || OCR_PROPAGATE_TOKEN` fallback, in a job that declares
// environment main-automation.
// Each case spawns the CLI a few times: a generous timeout so a loaded runner never turns
// a real result into a timeout.
describe(
  'CI integrity ratchets: token split (OSE-1695), born-red on injected faults',
  { timeout: 30_000 },
  () => {
    let root;
    const E = (body) => '$' + '{{ ' + body + ' }}';
    const READ_FB = E('secrets.OCR_HUB_READ || secrets.OCR_PROPAGATE_TOKEN');
    const READ_NEW = E('secrets.OCR_HUB_READ');
    const BARE = E('secrets.OCR_PROPAGATE_TOKEN');
    const AUTO_FB = E('secrets.OCR_AUTOMATION_WRITE || secrets.OCR_PROPAGATE_TOKEN');
    const NOTIFY_FB = E('secrets.OCR_NOTIFY_OSM || secrets.OCR_PROPAGATE_TOKEN');
    const REVERSED = E('secrets.OCR_PROPAGATE_TOKEN || secrets.OCR_HUB_READ');
    const FAKE_LITERAL = 'placeholder-not-a-real-credential';
    const HUB_WF = '.github/workflows/hub.yml';
    const CONF_WF = '.github/workflows/conformance-report.yml';
    const NOTIFY_WF = '.github/workflows/notify-osm-flag-change.yml';
    // The env var the staging script reads (SCRIPT_TOKEN_ENV): the read secret's own name.
    const TOKEN_ENV = 'OCR_HUB_READ';
    const stage = (name, value = READ_NEW, envName = TOKEN_ENV) =>
      `      - name: ${name}\n` +
      (value ? `        env:\n          ${envName}: ${value}\n` : '') +
      '        run: bash scripts/ci-stage-ocr-workspace.sh\n';
    const checkout = (token = READ_NEW) =>
      `      - name: brain\n        uses: actions/checkout@v7\n        with:\n          repository: ourCommunityRituals/OCR-docs\n          token: ${token}\n`;
    const hubWf = (steps, { top = '', jobEnv = '' } = {}) =>
      `on: pull_request\n${top}jobs:\n  build:\n${jobEnv}    steps:\n` + steps;
    const DEFAULT_STEPS = stage('stage A') + stage('stage B') + stage('stage C') + checkout();
    // Like main, each write job declares the main-automation environment (env '' drops it).
    const writeWf = (job, step, value, env = 'main-automation') =>
      `on: push\njobs:\n  ${job}:\n` +
      (env ? `    environment: ${env}\n` : '') +
      `    steps:\n      - name: ${step}\n        env:\n          GH_TOKEN: ${value}\n        run: gh api\n`;
    const baseline = () => JSON.parse(readFileSync(join(root, BASELINE), 'utf-8'));
    const writeBaseline = (b) =>
      writeFileSync(join(root, BASELINE), JSON.stringify(b, null, 2) + '\n');
    const snapshotBase = () => {
      const p = join(root, 'base.json');
      writeFileSync(p, readFileSync(join(root, BASELINE), 'utf-8'));
      return p;
    };

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'ci-int-token-'));
      put(root, HUB_WF, hubWf(DEFAULT_STEPS));
      put(root, CONF_WF, writeWf('generate', 'Open/update the conformance-refresh PR', AUTO_FB));
      put(root, NOTIFY_WF, writeWf('notify', 'Open issue in OSM', NOTIFY_FB));
      expect(run(root, '--update').status).toBe(0);
      const r = run(root);
      expect(r.stderr).toBe('');
      expect(r.stdout).toMatch(
        /readUsesOnNewSecret=4\(up\) writeUsesOnNewSecret=2\(up\) writeSitesInMainAutomation=2\(up\) bareOldTokenUses=0\(down\) fallbackUses=2\(down\) writeUsesOnWrongToken=0\(down\) unrecognizedTokenForms=0\(down\)/
      );
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    test('(a) a new bare secrets.OCR_PROPAGATE_TOKEN on a step: red, ceiling may not rise', () => {
      put(
        root,
        '.github/workflows/new.yml',
        `on: pull_request\njobs:\n  n:\n    steps:\n      - name: sneaky\n        env:\n          T: ${BARE}\n        run: echo\n`
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /bareOldTokenUses \[DOWN-ONLY.*baseline 0, current 1: went UP \(bad; the good direction is DOWN\)/
      );
      expect(r.stderr).toContain('.github/workflows/new.yml :: n :: sneaky');
      expect(r.stderr).toContain('Do not raise the baseline.');
    });

    test('(b) a read fallback that no longer names OCR_HUB_READ: up-only REGRESSION', () => {
      put(
        root,
        HUB_WF,
        hubWf(stage('stage A') + stage('stage B') + stage('stage C', BARE) + checkout())
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /REGRESSION readUsesOnNewSecret \[UP-ONLY.*baseline 4, current 3: went DOWN \(bad/
      );
      expect(r.stderr).toContain(`${HUB_WF} :: build :: stage C`);
      expect(r.stderr).toMatch(/bareOldTokenUses \[DOWN-ONLY.*current 1: went UP/);
    });

    test('(b2) a staging step that sets the OLD env name (the script reads OCR_HUB_READ): red', () => {
      put(
        root,
        HUB_WF,
        hubWf(
          stage('stage A') +
            stage('stage B') +
            stage('stage C', READ_NEW, 'OCR_PROPAGATE_TOKEN') +
            checkout()
        )
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /REGRESSION readUsesOnNewSecret \[UP-ONLY.*baseline 4, current 3: went DOWN \(bad/
      );
      expect(r.stderr).toContain(
        `${HUB_WF} :: build :: stage C  (staging site with no recognized read token (missing): OCR_HUB_READ is not set)`
      );
    });

    test('(c) a read site deleted: up-only REGRESSION naming it, with the retired recipe', () => {
      put(root, HUB_WF, hubWf(stage('stage A') + stage('stage B') + checkout()));
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/REGRESSION readUsesOnNewSecret \[UP-ONLY.*baseline 4, current 3/);
      expect(r.stderr).toContain(`${HUB_WF} :: build :: stage C`);
      expect(r.stderr).toContain('readUsesOnNewSecret.retired');
    });

    test('(d) a new correctly wired read step, baseline not raised: red "raise the baseline"', () => {
      put(
        root,
        '.github/workflows/new.yml',
        'on: pull_request\njobs:\n  n:\n    steps:\n' + stage('stage N', READ_NEW)
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /NOT REGISTERED readUsesOnNewSecret \[UP-ONLY.*baseline 4, current 5: went UP \(good\), so raise the baseline/
      );
      expect(r.stderr).toContain('.github/workflows/new.yml :: n :: stage N');
      expect(r.stderr).toContain('node scripts/ci/ci-integrity-ratchets.mjs --update');
      expect(r.stderr).not.toMatch(/fallbackUses/); // the new-only form adds no fallback
    });

    test('(d2) the same new step on the fallback form also raises fallbackUses (down-only)', () => {
      put(
        root,
        '.github/workflows/new.yml',
        'on: pull_request\njobs:\n  n:\n    steps:\n' + stage('stage N', READ_FB)
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/NOT REGISTERED readUsesOnNewSecret/);
      expect(r.stderr).toMatch(/fallbackUses \[DOWN-ONLY.*baseline 2, current 3: went UP/);
    });

    test('(e) a staging step with an unrecognized form (old token first): red', () => {
      put(
        root,
        HUB_WF,
        hubWf(stage('stage A') + stage('stage B') + stage('stage C', REVERSED) + checkout())
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /unrecognizedTokenForms \[DOWN-ONLY.*baseline 0, current 1: went UP/
      );
      expect(r.stderr).toContain(
        `${HUB_WF} :: build :: stage C  (step-level token expression in no recognized form)`
      );
      expect(r.stderr).toMatch(/REGRESSION readUsesOnNewSecret/);
    });

    test('(f) a wrong job-level value overriding a correct workflow-level one: red', () => {
      const steps = stage('stage A', '') + stage('stage B', '') + stage('stage C', '') + checkout();
      const top = `env:\n  ${TOKEN_ENV}: ${READ_NEW}\n`;
      put(root, HUB_WF, hubWf(steps, { top }));
      expect(run(root, '--update').status).toBe(0);
      expect(run(root).status).toBe(0);
      put(root, HUB_WF, hubWf(steps, { top, jobEnv: `    env:\n      ${TOKEN_ENV}: ${BARE}\n` }));
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/REGRESSION readUsesOnNewSecret \[UP-ONLY.*baseline 4, current 1/);
      expect(r.stderr).toMatch(/bareOldTokenUses \[DOWN-ONLY.*current 1: went UP/);
      expect(r.stderr).toContain(`${HUB_WF} :: build :: (job level)`);
    });

    test('(g) a new workflow with an odd invocation form and no token: red', () => {
      put(
        root,
        '.github/workflows/odd.yml',
        'on: pull_request\njobs:\n  o:\n    steps:\n      - name: odd\n        run: |\n          echo start\n          cd sub && bash ./scripts/ci-stage-ocr-workspace.sh\n'
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unrecognizedTokenForms \[DOWN-ONLY.*current 1: went UP/);
      expect(r.stderr).toContain(
        '.github/workflows/odd.yml :: o :: odd  (staging site with no recognized read token (missing): OCR_HUB_READ is not set)'
      );
    });

    test('(h) a composite action that runs the staging script: red', () => {
      put(
        root,
        '.github/actions/stage/action.yml',
        `name: stage\nruns:\n  using: composite\n  steps:\n    - name: stage hub\n      shell: bash\n      env:\n        ${TOKEN_ENV}: ${READ_NEW}\n      run: bash scripts/ci-stage-ocr-workspace.sh\n`
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unrecognizedTokenForms \[DOWN-ONLY.*current 1: went UP/);
      expect(r.stderr).toContain(
        '.github/actions/stage/action.yml :: (composite action) :: stage hub  (staging site with no recognized read token (composite)'
      );
    });

    test('(i) an OCR-docs checkout with a bare old token: red', () => {
      put(
        root,
        HUB_WF,
        hubWf(stage('stage A') + stage('stage B') + stage('stage C') + checkout(BARE))
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/REGRESSION readUsesOnNewSecret.*baseline 4, current 3/);
      expect(r.stderr).toContain(`${HUB_WF} :: build :: brain`);
      expect(r.stderr).toMatch(/bareOldTokenUses \[DOWN-ONLY.*current 1: went UP/);
    });

    test('(j) notify-osm put back on the automation token: red, ceiling 0 may not rise', () => {
      const base = snapshotBase();
      put(root, NOTIFY_WF, writeWf('notify', 'Open issue in OSM', AUTO_FB));
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /writeUsesOnWrongToken \[DOWN-ONLY.*baseline 0, current 1: went UP \(bad; the good direction is DOWN\)/
      );
      expect(r.stderr).toContain(
        `${NOTIFY_WF} :: notify :: Open issue in OSM  (expected secrets.OCR_NOTIFY_OSM; GH_TOKEN is an expression naming secrets.OCR_AUTOMATION_WRITE, secrets.OCR_PROPAGATE_TOKEN`
      );
      expect(r.stderr).not.toMatch(/writeUsesOnNewSecret|fallbackUses/); // nothing else moved
      // Raising the committed ceiling is locally consistent, but red against the base branch.
      expect(run(root, '--update').status).toBe(0);
      expect(run(root).status).toBe(0);
      const b = run(root, '--base-config', base);
      expect(b.status).toBe(1);
      expect(b.stderr).toMatch(
        /writeUsesOnWrongToken \[DOWN-ONLY\]: the committed ceiling 1 is above the base branch's 0/
      );
    });

    test('(k) a down-only ceiling raised above the base branch copy: red under --base-config', () => {
      const base = snapshotBase();
      put(root, HUB_WF, hubWf(DEFAULT_STEPS + stage('stage D', AUTO_FB)));
      expect(run(root, '--update').status).toBe(0); // ceilings raised in the committed file
      const local = run(root);
      expect(local.status).toBe(0); // locally consistent...
      const r = run(root, '--base-config', base); // ...but CI compares with the base branch
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /fallbackUses \[DOWN-ONLY\]: the committed ceiling 3 is above the base branch's 2/
      );
      expect(r.stderr).toMatch(
        /unrecognizedTokenForms \[DOWN-ONLY\]: the committed ceiling 1 is above the base branch's 0/
      );
    });

    test('(l1) an up-only floor lowered below the base branch copy, no retired entry: red', () => {
      const base = snapshotBase();
      put(root, HUB_WF, hubWf(stage('stage A') + stage('stage B') + checkout()));
      expect(run(root, '--update').status).toBe(0); // floor 4 -> 3, fallback ceiling stays 2
      expect(run(root).status).toBe(0);
      const r = run(root, '--base-config', base);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /REGRESSION readUsesOnNewSecret \[UP-ONLY\]: the committed floor 3 is below the base branch's 4\. The floor may rise, never fall/
      );
      expect(r.stderr).not.toContain('fallbackUses'); // a down-only key may fall
    });

    test('(l2) the same lowering with a matching retired entry: green', () => {
      const base = snapshotBase();
      put(root, HUB_WF, hubWf(stage('stage A') + stage('stage B') + checkout()));
      expect(run(root, '--update').status).toBe(0);
      const b = baseline();
      b.readUsesOnNewSecret.retired.push({
        file: HUB_WF,
        step: 'build :: stage C',
        reason: 'job deleted: the drill moved to another workflow',
        story: 'OSE-9999',
      });
      writeBaseline(b);
      const r = run(root, '--base-config', base);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    });

    test('(l3) lowering by more than the retired entries, or an invalid retired entry: red', () => {
      const base = snapshotBase();
      put(root, HUB_WF, hubWf(stage('stage A') + checkout()));
      expect(run(root, '--update').status).toBe(0); // floor 4 -> 2 (stage B and C deleted)
      const b = baseline();
      b.readUsesOnNewSecret.retired.push(
        {
          file: HUB_WF,
          step: 'build :: stage C',
          reason: 'job deleted: moved elsewhere',
          story: 'OSE-9',
        },
        { file: HUB_WF, step: 'build :: stage B', reason: 'job deleted for good reasons' },
        {
          file: HUB_WF,
          step: 'build :: ghost',
          reason: 'never existed on the base',
          story: 'OSE-1',
        }
      );
      writeBaseline(b);
      const r = run(root, '--base-config', base);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/retired\[new #2\] needs a story id like OSE-1234/);
      expect(r.stderr).toMatch(
        /"\.github\/workflows\/hub\.yml :: build :: ghost" was not counted on the base branch/
      );
      // Only the one valid entry lowers the floor: 4 - 1 = 3 > 2.
      expect(r.stderr).toMatch(
        /committed floor 2 is below the base branch's 4 minus 1 newly retired site\(s\) = 3/
      );
    });

    test('a key absent from the base copy is new: its base-branch check is skipped', () => {
      const base = join(root, 'base.json');
      const b = baseline();
      for (const k of TOKEN_KEYS) delete b[k];
      writeFileSync(base, JSON.stringify(b));
      const r = run(root, '--base-config', base);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    });

    test('a swap at equal totals (one read site renamed) is red both ways', () => {
      put(root, HUB_WF, hubWf(stage('stage A') + stage('stage B') + stage('stage Z') + checkout()));
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/REGRESSION readUsesOnNewSecret.*baseline 4, current 4/);
      expect(r.stderr).toMatch(/NOT REGISTERED readUsesOnNewSecret.*baseline 4, current 4/);
    });

    test('a down-only swap at equal totals (one fallback removed, one added) is red', () => {
      // conformance drops its fallback (-1); a read step gains one (+1): fallbackUses stays 2.
      put(
        root,
        CONF_WF,
        writeWf(
          'generate',
          'Open/update the conformance-refresh PR',
          E('secrets.OCR_AUTOMATION_WRITE')
        )
      );
      put(
        root,
        HUB_WF,
        hubWf(stage('stage A') + stage('stage B') + stage('stage C', READ_FB) + checkout())
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/fallbackUses \[DOWN-ONLY.*baseline 2, current 2: went UP/);
      expect(r.stderr).toContain(`${HUB_WF} :: build :: stage C`);
      expect(r.stderr).toMatch(
        /fallbackUses \[DOWN-ONLY.*baseline 2, current 2: went DOWN \(good\)/
      );
    });

    test('a renamed write site is no longer counted: up-only REGRESSION', () => {
      put(root, CONF_WF, writeWf('generate', 'Open the conformance PR', AUTO_FB));
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/REGRESSION writeUsesOnNewSecret \[UP-ONLY.*baseline 2, current 1/);
      expect(r.stderr).toContain(
        `${CONF_WF} :: generate :: Open/update the conformance-refresh PR`
      );
    });

    test('(m) a write job that drops environment main-automation: up-only REGRESSION naming it', () => {
      put(
        root,
        CONF_WF,
        writeWf('generate', 'Open/update the conformance-refresh PR', AUTO_FB, '')
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /REGRESSION writeSitesInMainAutomation \[UP-ONLY.*baseline 2, current 1: went DOWN \(bad/
      );
      expect(r.stderr).toContain(
        `${CONF_WF} :: generate :: Open/update the conformance-refresh PR`
      );
      expect(r.stderr).toContain('environment: main-automation');
      expect(r.stderr).not.toMatch(/writeUsesOnNewSecret|fallbackUses/); // the token is unchanged
    });

    test('(m2) a write job on another environment (or a typo) is not counted: red', () => {
      put(root, NOTIFY_WF, writeWf('notify', 'Open issue in OSM', NOTIFY_FB, 'main-automaton'));
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/REGRESSION writeSitesInMainAutomation.*baseline 2, current 1/);
      expect(r.stderr).toContain(`${NOTIFY_WF} :: notify :: Open issue in OSM`);
    });

    test('(m3) the new key against a base copy without it: accepted (first introduction)', () => {
      const b = baseline();
      delete b.writeSitesInMainAutomation;
      put(root, 'base.json', JSON.stringify(b));
      const r = run(root, '--base-config', join(root, 'base.json'));
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    });

    test('a literal token is never printed; an unparseable workflow is red', () => {
      put(
        root,
        HUB_WF,
        hubWf(stage('stage A') + stage('stage B') + stage('stage C', FAKE_LITERAL) + checkout())
      );
      put(
        root,
        '.github/workflows/broken.yml',
        'jobs:\n  a:\n    steps:\n      - name: x\n        run: echo\n          bad: [\n'
      );
      const r = run(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('a literal value (not printed');
      expect(r.stderr + r.stdout).not.toContain(FAKE_LITERAL);
      expect(r.stderr).toMatch(/token split: cannot parse \.github\/workflows\/broken\.yml/);
    });

    test('--update keeps every reason and retired entry, and writes each direction', () => {
      const b = baseline();
      b.readUsesOnNewSecret.byFile[HUB_WF].reason = 'builds the Worker with the pinned hub';
      b.writeUsesOnWrongToken.reason = 'known violation, falls with OSE-1695';
      b.readUsesOnNewSecret.retired = [
        { file: 'x.yml', step: 'j :: s', reason: 'a deleted job kept for history', story: 'OSE-1' },
      ];
      writeBaseline(b);
      expect(run(root, '--update').status).toBe(0);
      const a = baseline();
      expect(a.readUsesOnNewSecret.byFile[HUB_WF].reason).toBe(
        'builds the Worker with the pinned hub'
      );
      expect(a.writeUsesOnWrongToken.reason).toBe('known violation, falls with OSE-1695');
      expect(a.readUsesOnNewSecret.retired).toEqual(b.readUsesOnNewSecret.retired);
      expect(TOKEN_KEYS.map((k) => a[k].direction)).toEqual([
        'up',
        'up',
        'up',
        'down',
        'down',
        'down',
        'down',
      ]);
    });
  }
);

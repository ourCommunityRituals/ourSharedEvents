/**
 * CI failure triage (scripts/ci/classify-ci-failure.mjs): fixed rules name the
 * root job of a failed run and set the cascade aside.
 *
 * The first block replays real failed runs of 2026-10-11 and 12 (job, failed
 * step and failure annotations exactly as GitHub reported them), so the rules
 * are held to what actually happens in this pipeline.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ci', 'classify-ci-failure.mjs');

// Every case spawns a process; give them room on a busy runner.
vi.setConfig({ testTimeout: 30_000 });

function triage(failed, ...flags) {
  const file = join(mkdtempSync(join(tmpdir(), 'ci-triage-')), 'failed.json');
  writeFileSync(file, JSON.stringify(failed));
  const r = spawnSync(process.execPath, [SCRIPT, '--file', file, ...flags], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return flags.includes('--json') ? JSON.parse(r.stdout) : r.stdout;
}

const EXIT1 = 'Process completed with exit code 1.';
const T0_GATE = {
  job: 'T0 Gate (tests)',
  step: 'Summarize T0 test sub-gates',
  messages: [EXIT1, 'One or more T0 test sub-gates failed or were cancelled'],
};
const RECONCILER = {
  job: 'Gate-execution reconciler',
  step: 'Reconcile gate execution',
  messages: [EXIT1],
};
const T4_SUMMARY = {
  job: 'T4 Functional → Staging',
  step: 'Summarize T4 functional legs',
  messages: [EXIT1, 'One or more T4 functional legs failed or were cancelled'],
};
const T4_SURFACES =
  'T4 Functional (surfaces: UI, attendee arc, SharedReport, launch story, poster)';

describe('ci triage: real failed runs', () => {
  test('run 38216569815: a root test failed; the gate summary and reconciler are consequences', () => {
    const r = triage(
      [
        { job: 'T0 Tests (root-vitest)', step: 'Run T0 test section', messages: [EXIT1] },
        T0_GATE,
        RECONCILER,
      ],
      '--json'
    );
    expect(r.class).toBe('test');
    expect(r.root).toBe('T0 Tests (root-vitest)');
    expect(r.cascades).toEqual(['T0 Gate (tests)', 'Gate-execution reconciler']);
  });

  test('run 38178407459: the secret scan is the root, not the T0 gate', () => {
    const r = triage(
      [
        {
          job: 'S0 Security',
          step: 'detect-secrets scan (committed-secret gate)',
          messages: [EXIT1, 'detect-secrets found secret(s) not present in .secrets.baseline:'],
        },
        T0_GATE,
      ],
      '--json'
    );
    expect(r).toMatchObject({
      class: 'secret-scan',
      root: 'S0 Security',
      cascades: ['T0 Gate (tests)'],
    });
    expect(r.roots[0].next).toMatch(/Do not re-baseline from Windows/);
  });

  test('run 38186322781: a ratchet outranks the test failure it also caused', () => {
    const r = triage(
      [
        {
          job: 'T0 Gate (lint)',
          step: 'Lint: CI integrity ratchets (skips, continue-on-error, orphan specs)',
          messages: [
            EXIT1,
            'ci-integrity: skipsConditional: 366 > baseline 365 (a new one was added; remove it or fix the cause)',
          ],
        },
        { job: 'T0 Tests (root-vitest)', step: 'Run T0 test section', messages: [EXIT1] },
        T0_GATE,
      ],
      '--json'
    );
    expect(r.class).toBe('ratchet');
    expect(r.root).toBe('T0 Gate (lint)');
    expect(r.roots.map((x) => x.class)).toEqual(['ratchet', 'test']);
    expect(r.roots[0].next).toMatch(/Do not raise the baseline/);
  });

  test('run 38162352541: a staging seed step failed, so no tests ran', () => {
    const r = triage(
      [
        {
          job: T4_SURFACES,
          step: 'Seed Eagles Hall trace poster (OSE-616 fixture)',
          messages: ['No test report files were found', EXIT1],
        },
        T4_SUMMARY,
      ],
      '--json'
    );
    expect(r).toMatchObject({
      class: 'staging-setup',
      root: T4_SURFACES,
      cascades: ['T4 Functional → Staging'],
    });
  });

  test('run 38155427822: a T4 journey failed', () => {
    const r = triage(
      [{ job: T4_SURFACES, step: 'T4e: Attendee Arc Journey', messages: [EXIT1] }, T4_SUMMARY],
      '--json'
    );
    expect(r).toMatchObject({ class: 'test', root: T4_SURFACES });
  });
});

describe('ci triage: rules', () => {
  test.each([
    ['ECONNRESET (the publish-loop flake on record)', 'Error: read ECONNRESET'],
    ['apt mirror stall', 'Temporary failure resolving archive.ubuntu.com'],
    ['Cloudflare challenge page', '403: <title>Just a moment...</title>'],
    ['runner shutdown', 'The runner has received a shutdown signal.'],
    ['DNS', 'getaddrinfo EAI_AGAIN registry.npmjs.org'],
  ])('infra: %s', (_name, message) => {
    const r = triage(
      [{ job: 'T3 Smoke (forms)', step: 'Run smoke', messages: [message, EXIT1] }],
      '--json'
    );
    expect(r.class).toBe('infra');
    expect(r.roots[0].next).toMatch(/Re-run the failed jobs once/);
  });

  test('a lint step is lint', () => {
    expect(
      triage([{ job: 'T0 Gate (lint)', step: 'Lint: eslint', messages: [EXIT1] }], '--json').class
    ).toBe('lint');
  });

  test('a failure no rule matches is unknown, never guessed', () => {
    const r = triage([{ job: 'Something new', step: 'Do a thing', messages: [EXIT1] }], '--json');
    expect(r.class).toBe('unknown');
    expect(r.roots[0].next).toMatch(/add a rule/);
  });

  test('a real failure outranks infra noise in the same run', () => {
    const r = triage(
      [
        { job: 'T3 Smoke (forms)', step: 'Run smoke', messages: ['read ECONNRESET'] },
        {
          job: 'S0 Security',
          step: 'detect-secrets scan (committed-secret gate)',
          messages: [EXIT1],
        },
      ],
      '--json'
    );
    expect(r.class).toBe('secret-scan');
  });

  test('only gate summaries red: the root was cancelled or skipped', () => {
    const r = triage([T0_GATE, RECONCILER], '--json');
    expect(r).toMatchObject({ class: 'cascade-only', root: null });
    expect(triage([T0_GATE, RECONCILER])).toMatch(/cancelled or skipped/);
  });

  test('no failed jobs', () => {
    expect(triage([], '--json').class).toBe('none');
  });

  test('the text report names the root, the next step and what to ignore', () => {
    const out = triage([
      {
        job: 'S0 Security',
        step: 'detect-secrets scan (committed-secret gate)',
        messages: [EXIT1],
      },
      T0_GATE,
    ]);
    expect(out).toMatch(/^Root: S0 Security {2}\[secret-scan\]/);
    expect(out).toMatch(/Next: /);
    expect(out).toMatch(/Ignore \(red only as a consequence\): T0 Gate \(tests\)/);
  });
});

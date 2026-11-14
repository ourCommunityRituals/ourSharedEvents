/**
 * [Claude] No actions/checkout leaves the job's GITHUB_TOKEN on disk, and every job that runs
 * pull-request code starts with step-security/harden-runner.
 *
 * 1. CREDENTIALS. checkout's default `persist-credentials: true` writes the job's token into
 *    git config (an http extraheader for github.com) for every later step to read: `npm ci`
 *    scripts, tests, any action. Every checkout in every workflow and composite action sets
 *    the YAML boolean `persist-credentials: false`, unless it is listed in PERSIST_ALLOWED
 *    below with the reason a later step needs the stored credential (a `git push`, or an
 *    authenticated fetch of a private repository). The same checkout carries that reason as
 *    a YAML comment. The repo is public, so a plain `git fetch origin` needs no credential.
 *    The list is empty today. tests/integration/adr008-wiring.test.js checks the same thing
 *    for the token-holding jobs only (scripts/ci/hub-token-wiring.mjs); this file reuses its
 *    `isCheckout` and `persistCredentialsShape` so the two can never disagree about what a
 *    checkout is or what counts as false.
 *
 * 2. HARDEN-RUNNER. A job runs pull-request code when its workflow is triggered by
 *    pull_request, pull_request_target or issue_comment (a comment on a PR) and it checks out
 *    this repository at a ref other than the PR's base. Each such job's FIRST step is
 *    step-security/harden-runner with `egress-policy: audit`, so outbound calls made while PR
 *    code runs are recorded. Jobs whose `if:` never lets them run on those events are listed
 *    in HARDEN_EXEMPT with the reason.
 *
 * Both lists are checked for stale entries, and both detectors run on planted workflows
 * first, so neither check can pass vacuously.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- paths are this repo's .github files, listed by the test */

const { readdirSync, readFileSync, existsSync, statSync } = require('fs');
const { join, relative, sep } = require('path');
const { pathToFileURL } = require('url');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const ACTIONS = join(ROOT, '.github', 'actions');

/**
 * Checkouts allowed to keep the credential: "file :: job :: step label" -> reason.
 * Keep empty unless a later step in that job pushes or fetches a private repo with it.
 */
const PERSIST_ALLOWED = {};

/** PR-triggered jobs that never run on a PR event: "file :: job" -> reason. */
const HARDEN_EXEMPT = {
  'branch-protection-drift.yml :: full-settings':
    'if: schedule or workflow_dispatch only; never runs on a pull_request',
  'mobile-workability-audit.yml :: nightly-staging':
    'if: schedule or workflow_dispatch only; never runs on a pull_request',
  'oursharedevents-ci.yml :: deploy-production':
    'if: a v* tag push or a PRODUCTION dispatch only; never runs on a pull_request',
  'oursharedevents-ci.yml :: smoke-production':
    'needs deploy-production, which never runs on a pull_request, so it is always skipped there',
};

const HARDEN = /^step-security\/harden-runner@[0-9a-f]{40}$/;
const PR_EVENTS = ['pull_request', 'pull_request_target', 'issue_comment'];

let w;
beforeAll(async () => {
  w = await import(pathToFileURL(join(ROOT, 'scripts', 'ci', 'hub-token-wiring.mjs')).href);
});

const label = (step, i) => step?.name || step?.id || `step ${i + 1}`;
const triggers = (doc) => {
  const on = doc?.on ?? doc?.[true];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on || {});
};

/** Every checkout in a parsed workflow or composite action: { where, ok, shape }. */
function checkouts(doc, file) {
  const out = [];
  const visit = (where, steps) =>
    (Array.isArray(steps) ? steps : []).forEach((step, i) => {
      if (!w.isCheckout(step)) return;
      const { ok, shape } = w.persistCredentialsShape(step.with);
      out.push({ where: `${where} :: ${label(step, i)}`, ok, shape });
    });
  for (const [jid, job] of Object.entries(doc?.jobs || {})) visit(`${file} :: ${jid}`, job?.steps);
  if (doc?.runs?.steps) visit(`${file} :: (composite)`, doc.runs.steps);
  return out;
}

/** Checkouts that persist credentials and are not allowlisted, as readable lines. */
function persisting(doc, file, allowed = PERSIST_ALLOWED) {
  return checkouts(doc, file)
    .filter((c) => !c.ok && !(c.where in allowed))
    .map((c) => `${c.where}: persist-credentials is ${c.shape}. Fix: ${w.CHECKOUT_PERSIST_FIX}.`);
}

/** Jobs that run PR code: { key, first } where first is the first step's `uses`. */
function prCodeJobs(doc, file) {
  if (!triggers(doc).some((t) => PR_EVENTS.includes(t))) return [];
  const out = [];
  for (const [jid, job] of Object.entries(doc?.jobs || {})) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const runsPrCode = steps.some((s) => {
      if (!w.isCheckout(s)) return false;
      const repo = String(s.with?.repository || '');
      if (repo && !/\$\{\{\s*github\.repository\s*\}\}/.test(repo)) return false;
      return !/pull_request\.base\./.test(String(s.with?.ref || ''));
    });
    if (runsPrCode) out.push({ key: `${file} :: ${jid}`, first: steps[0] });
  }
  return out;
}

/** PR-code jobs whose first step is not an audit-mode, SHA-pinned harden-runner. */
function unhardened(doc, file, exempt = HARDEN_EXEMPT) {
  return prCodeJobs(doc, file)
    .filter(({ key }) => !(key in exempt))
    .filter(({ first }) => {
      const uses = String(first?.uses || '');
      return !(HARDEN.test(uses) && first?.with?.['egress-policy'] === 'audit');
    })
    .map(
      ({ key, first }) =>
        `${key}: first step is ${first?.uses || label(first, 0)}, not harden-runner (audit)`
    );
}

function workflowFiles() {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, path: join(WORKFLOWS, f) }));
}

function actionFiles() {
  if (!existsSync(ACTIONS)) return [];
  const out = [];
  const walk = (dir) =>
    readdirSync(dir).forEach((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/^action\.ya?ml$/.test(n)) {
        out.push({ file: relative(ROOT, p).split(sep).join('/'), path: p });
      }
    });
  walk(ACTIONS);
  return out;
}

const load = ({ path }) => yaml.load(readFileSync(path, 'utf8'));

const HR = 'step-security/harden-runner@e14015d583714f6e62063499dc959a02595150a1';
const CO = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';

describe('checkouts do not persist the job token', () => {
  test('detector: unset, true, strings and expressions are caught; boolean false and allowlisted pass', () => {
    const doc = yaml.load(`
on: push
jobs:
  j:
    steps:
      - uses: ${CO}
      - name: true
        uses: actions/checkout@v7
        with: { persist-credentials: true }
      - name: string
        uses: ACTIONS/Checkout@v7
        with: { persist-credentials: 'false' }
      - name: expr
        uses: actions/checkout
        with: { persist-credentials: '\${{ false }}' }
      - name: ok
        uses: ${CO}
        with: { persist-credentials: false }
      - name: allowed
        uses: ${CO}
      - name: not a checkout
        uses: actions/setup-node@v6
`);
    const bad = persisting(doc, 'x.yml', { 'x.yml :: j :: allowed': 'pushes' });
    expect(bad.map((l) => l.split(':').slice(0, 5).join(':'))).toEqual([
      'x.yml :: j :: step 1',
      'x.yml :: j :: true',
      'x.yml :: j :: string',
      'x.yml :: j :: expr',
    ]);
    expect(bad[0]).toContain('defaults to true');
    const composite = yaml.load(`runs:\n  using: composite\n  steps:\n    - uses: ${CO}\n`);
    expect(persisting(composite, 'a/action.yml')).toHaveLength(1);
  });

  test('every workflow and composite action', () => {
    const files = [...workflowFiles(), ...actionFiles()];
    expect(files.length).toBeGreaterThan(10);
    const all = files.flatMap((f) => checkouts(load(f), f.file));
    expect(all.length).toBeGreaterThan(50);
    expect(files.flatMap((f) => persisting(load(f), f.file))).toEqual([]);
  });

  test('every allowlisted checkout still exists, still persists, and says why in the YAML', () => {
    const files = [...workflowFiles(), ...actionFiles()];
    const all = files.flatMap((f) => checkouts(load(f), f.file));
    for (const [where, reason] of Object.entries(PERSIST_ALLOWED)) {
      expect(reason.length, where).toBeGreaterThan(10);
      const c = all.find((x) => x.where === where);
      expect(c, `${where}: allowlisted checkout not found`).toBeDefined();
      expect(c.ok, `${where}: no longer persists; drop it from PERSIST_ALLOWED`).toBe(false);
      const text = readFileSync(join(WORKFLOWS, where.split(' :: ')[0]), 'utf8');
      expect(text, `${where}: add a "# persist-credentials kept: <reason>" comment`).toMatch(
        /#\s*persist-credentials kept:/
      );
    }
  });
});

describe('jobs that run pull-request code start with harden-runner', () => {
  test('detector: PR-code jobs without a first-step audit harden-runner are caught', () => {
    const doc = yaml.load(`
on: { pull_request: {}, push: {} }
jobs:
  hardened:
    steps:
      - uses: ${HR} # v2
        with: { egress-policy: audit }
      - uses: ${CO}
  second:
    steps:
      - uses: ${CO}
      - uses: ${HR}
        with: { egress-policy: audit }
  block:
    steps:
      - uses: ${HR}
        with: { egress-policy: block }
      - uses: ${CO}
  tag:
    steps:
      - uses: step-security/harden-runner@v2
        with: { egress-policy: audit }
      - uses: ${CO}
  base-only:
    steps:
      - uses: ${CO}
        with: { ref: '\${{ github.event.pull_request.base.sha }}' }
  other-repo:
    steps:
      - uses: ${CO}
        with: { repository: ourCommunityRituals/OCR-docs }
  no-checkout:
    steps:
      - run: echo hi
  exempt:
    steps:
      - uses: ${CO}
`);
    expect(unhardened(doc, 'x.yml', { 'x.yml :: exempt': 'never on PR' })).toEqual([
      `x.yml :: second: first step is ${CO}, not harden-runner (audit)`,
      `x.yml :: block: first step is ${HR}, not harden-runner (audit)`,
      'x.yml :: tag: first step is step-security/harden-runner@v2, not harden-runner (audit)',
    ]);
    expect(
      unhardened(yaml.load(`on: push\njobs:\n  j:\n    steps:\n      - uses: ${CO}\n`), 'p.yml')
    ).toEqual([]);
    expect(
      unhardened(
        yaml.load(`on: [issue_comment]\njobs:\n  j:\n    steps:\n      - uses: ${CO}\n`),
        'c.yml'
      )
    ).toHaveLength(1);
  });

  test('every workflow', () => {
    const files = workflowFiles();
    expect(files.flatMap((f) => prCodeJobs(load(f), f.file)).length).toBeGreaterThan(20);
    expect(files.flatMap((f) => unhardened(load(f), f.file))).toEqual([]);
  });

  test('every exemption is a real PR-code job that is still unhardened', () => {
    const jobs = workflowFiles().flatMap((f) => prCodeJobs(load(f), f.file));
    for (const [key, reason] of Object.entries(HARDEN_EXEMPT)) {
      expect(reason.length, key).toBeGreaterThan(10);
      const j = jobs.find((x) => x.key === key);
      expect(j, `${key}: exempt job not found`).toBeDefined();
      expect(
        HARDEN.test(String(j.first?.uses || '')),
        `${key}: now hardened; drop the exemption`
      ).toBe(false);
    }
  });
});

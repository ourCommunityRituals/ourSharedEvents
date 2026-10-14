/**
 * ADR-008 Phase 0 wiring meta-gate (OSE-1399, CCR OSE-1393 D3).
 *
 * The Phase 0 controls are CI wiring, and wiring can be deleted without any
 * other gate going red. This asserts the properties, deriving the subject list
 * from .github/workflows/* (property-asserting, per
 * tests/e2e/0-architecture/README.md) rather than naming jobs:
 *
 *   1. Every job that installs, tests, builds or deploys the Worker stages the
 *      pinned hub (@ocr/ui) BEFORE its first Worker build step, and that
 *      staging step is not continue-on-error (npm ci succeeds on a dangling
 *      file: link, so a skipped stage surfaces later as a confusing import).
 *   2. The blocking design check (@ocr/ui check-spoke-styles) exists, runs from
 *      the staged hub, and is not continue-on-error.
 *   3. .ocr-hub-ref is one full 40-hex SHA.
 *   4. The staging script refuses pins that are not on hub main (OSE-1394).
 *   5. Token split (OSE-1695), across EVERY workflow and composite action,
 *      whatever the trigger: every read site (a step that runs
 *      ci-stage-ocr-workspace.sh, a hub / OCR-docs checkout) uses a read form
 *      that names OCR_HUB_READ, never the bare write-capable OCR_PROPAGATE_TOKEN;
 *      the two named write steps use write forms; nothing else names the old
 *      token or a write secret; the staging script authenticates with env
 *      OCR_HUB_READ and never expands the old name (no fallback to the write PAT).
 *      The enumerator is scripts/ci/hub-token-wiring.mjs,
 *      shared with the progress ratchet (scripts/ci/ci-integrity-ratchets.mjs), so
 *      the property and the counts never come from two parsers.
 *
 * Each detector is proven against synthetic negative controls first, so the
 * gate cannot pass vacuously.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');

const BUILD =
  /\bnpm (ci|install|test|run test)|\bvitest\b|wrangler (deploy|dev)\b|test:mutation|stryker/;
const STAGE = /ci-stage-ocr-workspace\.sh/;

function workingDir(job, step) {
  return String(step['working-directory'] || job.defaults?.run?.['working-directory'] || '');
}

function isWorkerBuildStep(job, step) {
  const run = String(step.run || '');
  const wd = workingDir(job, step);
  const inWorker =
    /WORKER_DIR|workers\/oursharedevents|matrix\.workdir/.test(wd) ||
    run.includes('cd workers/oursharedevents');
  return inWorker && BUILD.test(run);
}

/** Violations of property 1 for one parsed workflow. */
function stagingViolations(workflow, file) {
  const out = [];
  let workerJobs = 0;
  for (const [name, job] of Object.entries(workflow.jobs || {})) {
    const steps = job.steps || [];
    const firstBuild = steps.findIndex((s) => isWorkerBuildStep(job, s));
    if (firstBuild === -1) continue;
    workerJobs++;
    const stage = steps.findIndex((s) => STAGE.test(String(s.run || '')));
    if (stage === -1 || stage > firstBuild) {
      out.push(`${file}:${name} builds the Worker without staging the pinned hub first`);
    } else if (
      steps[stage]['continue-on-error'] !== undefined &&
      steps[stage]['continue-on-error'] !== false
    ) {
      out.push(`${file}:${name} stages the hub with continue-on-error`);
    }
    if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false) {
      out.push(`${file}:${name} is continue-on-error at job level`);
    }
  }
  return { out, workerJobs };
}

function realWorkflows() {
  return readdirSync(WF_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, wf: yaml.load(readFileSync(join(WF_DIR, f), 'utf8')) }));
}

describe('ADR-008 wiring meta-gate (OSE-1399)', () => {
  describe('negative controls — the detectors can fail', () => {
    const build = { 'working-directory': '${{ env.WORKER_DIR }}', run: 'npm ci' };
    const stage = { run: 'bash scripts/ci-stage-ocr-workspace.sh' };

    test('a Worker job with no staging step is flagged', () => {
      const { out } = stagingViolations({ jobs: { j: { steps: [build] } } }, 'x.yml');
      expect(out).toEqual(['x.yml:j builds the Worker without staging the pinned hub first']);
    });

    test('staging after the first build step is flagged', () => {
      const { out } = stagingViolations({ jobs: { j: { steps: [build, stage] } } }, 'x.yml');
      expect(out).toHaveLength(1);
    });

    test('a continue-on-error staging step is flagged', () => {
      const wf = { jobs: { j: { steps: [{ ...stage, 'continue-on-error': true }, build] } } };
      expect(stagingViolations(wf, 'x.yml').out).toEqual([
        'x.yml:j stages the hub with continue-on-error',
      ]);
    });

    test('a job-default working directory counts as the Worker', () => {
      const wf = {
        jobs: {
          j: {
            defaults: { run: { 'working-directory': 'workers/oursharedevents' } },
            steps: [{ run: 'npm ci' }],
          },
        },
      };
      expect(stagingViolations(wf, 'x.yml').out).toHaveLength(1);
    });

    test('a correctly wired job passes', () => {
      expect(stagingViolations({ jobs: { j: { steps: [stage, build] } } }, 'x.yml').out).toEqual(
        []
      );
    });
  });

  test('every Worker-building job stages the pinned hub first, without continue-on-error', () => {
    let total = 0;
    const violations = [];
    for (const { file, wf } of realWorkflows()) {
      const { out, workerJobs } = stagingViolations(wf, file);
      total += workerJobs;
      violations.push(...out);
    }
    expect(violations).toEqual([]);
    // Anti-vacuity: the detector must actually find the Worker jobs (10 on 2026-09-29).
    expect(total).toBeGreaterThanOrEqual(8);
  });

  test('the blocking design check runs from the staged hub and is not continue-on-error', () => {
    const wf = yaml.load(readFileSync(join(WF_DIR, 'oursharedevents-ci.yml'), 'utf8'));
    const hits = [];
    for (const [name, job] of Object.entries(wf.jobs || {})) {
      const steps = job.steps || [];
      steps.forEach((s, i) => {
        if (/check-spoke-styles\.mjs/.test(String(s.run || ''))) {
          hits.push({ name, job, steps, i, s });
        }
      });
    }
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const { name, steps, i, s } of hits) {
      expect(String(s.run), name).toMatch(/\.\.\/packages\/ui\/scripts\/check-spoke-styles\.mjs/);
      expect(s['continue-on-error'], `${name} design check`).toBeUndefined();
      const stage = steps.findIndex((x) => STAGE.test(String(x.run || '')));
      expect(stage, `${name} stages the hub before the design check`).toBeGreaterThanOrEqual(0);
      expect(stage).toBeLessThan(i);
    }
  });

  test('.ocr-hub-ref pins one full 40-hex hub SHA', () => {
    expect(readFileSync(join(ROOT, '.ocr-hub-ref'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  test('the staging script refuses pins that are not on hub main (OSE-1394)', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'ci-stage-ocr-workspace.sh'), 'utf8');
    expect(script).toMatch(/merge-base --is-ancestor "\$REF"/);
    expect(script).toMatch(/\[\[ "\$REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  });
});

// ── 5. Token split (OSE-1695) ──────────────────────────────────────────────
// `${{ ... }}` is built as '$' + '{{' so JS template literals never expand it.
const E = (body) => '$' + '{{ ' + body + ' }}';
// The env var the staging script authenticates with: the read secret's own name, with no
// fallback to the old OCR_PROPAGATE_TOKEN variable (pinned by the last test below).
const TOKEN_ENV = 'OCR_HUB_READ';
const READ_NEW = E('secrets.OCR_HUB_READ');
// The PR #986 read fallback: still a RECOGNIZED read form, but counted by the down-only
// fallbackUses ratchet, so it cannot return to a real read site.
const READ_FB = E('secrets.OCR_HUB_READ || secrets.OCR_PROPAGATE_TOKEN');
const BARE = E('secrets.OCR_PROPAGATE_TOKEN');
const AUTO_FB = E('secrets.OCR_AUTOMATION_WRITE || secrets.OCR_PROPAGATE_TOKEN');
const NOTIFY_FB = E('secrets.OCR_NOTIFY_OSM || secrets.OCR_PROPAGATE_TOKEN');
const FAKE_LITERAL = 'placeholder-not-a-real-credential';
// Files outside .github/workflows, tests/, docs and *.md that mention the staging
// script, each classified. A new mention fails until someone decides whether it is an
// invocation (then it must carry a read token from a workflow step) or a reference.
const KNOWN_MENTIONS = {
  'scripts/ci/hub-token-wiring.mjs': 'the enumerator that finds invocations; not an invocation',
  'scripts/ci/phone-audit-scope.mjs':
    'a path-filter list entry (a pin bump re-runs the phone audit); not an invocation',
  'scripts/worktree-link-deps.mjs':
    'a comment explaining where ../packages comes from; not an invocation',
};

describe('token split (OSE-1695): every workflow and composite action', () => {
  let w;
  let s;
  beforeAll(async () => {
    w = await import(pathToFileURL(join(ROOT, 'scripts', 'ci', 'hub-token-wiring.mjs')).href);
    s = w.scan(ROOT, { fresh: true });
  });
  const analyze = (text, kind = 'workflow', file = 'x.yml', aliases = []) =>
    w.analyzeDoc(yaml.load(text), file, kind, aliases);
  const job = (steps, jobEnv = '') => `on: push\njobs:\n  j:\n${jobEnv}    steps:\n${steps}`;
  const stage = (name, value) =>
    `      - name: ${name}\n` +
    (value ? `        env:\n          ${TOKEN_ENV}: ${value}\n` : '') +
    '        run: bash scripts/ci-stage-ocr-workspace.sh\n';
  const forms = (r) => r.sites.map((x) => `${x.kind}:${x.step}:${x.form}`);
  const key = (x) => `${x.file} :: ${x.id}`;

  describe('negative controls: every form and invocation is found and classified', () => {
    test('expression forms: whitespace, bracket and case spellings; the new secret must come first', () => {
      const c = (b) => w.classifyExpression(b);
      expect(c('secrets.OCR_PROPAGATE_TOKEN')).toBe('bare');
      expect(c("secrets['ocr_propagate_token']")).toBe('bare');
      expect(c('secrets.OCR_HUB_READ||secrets.OCR_PROPAGATE_TOKEN')).toBe('read-fallback');
      expect(c(" Secrets [ 'OCR_HUB_READ' ]  ||  secrets.ocr_propagate_token ")).toBe(
        'read-fallback'
      );
      expect(c('secrets.OCR_AUTOMATION_WRITE || secrets.OCR_PROPAGATE_TOKEN')).toBe(
        'write-fallback-automation'
      );
      expect(c('secrets.OCR_NOTIFY_OSM || secrets.OCR_PROPAGATE_TOKEN')).toBe(
        'write-fallback-notify'
      );
      expect(c('secrets.OCR_HUB_READ')).toBe('new-only-read');
      expect(c('secrets.OCR_AUTOMATION_WRITE')).toBe('new-only-automation');
      expect(c('secrets.OCR_NOTIFY_OSM')).toBe('new-only-notify');
      // `||` returns the first truthy operand: OLD first would always pick the write PAT.
      expect(c('secrets.OCR_PROPAGATE_TOKEN || secrets.OCR_HUB_READ')).toBe('unrecognized');
      expect(c("secrets.OCR_HUB_READ || ''")).toBe('unrecognized');
      expect(c("format('{0}', secrets.OCR_PROPAGATE_TOKEN)")).toBe('unrecognized');
      expect(c('secrets.OTHER || secrets.OCR_PROPAGATE_TOKEN')).toBe('unrecognized');
      expect(c('toJSON(secrets)')).toBe('unrecognized'); // the whole context, old token included
      expect(c('github.token')).toBeNull();
      expect(c('secrets.GITHUB_TOKEN')).toBeNull();
    });

    test('multi-line run, after cd and &&, no env: found, no token', () => {
      const r = analyze(
        job(
          '      - name: odd\n        run: |\n          echo start\n          cd x && bash ./scripts/ci-stage-ocr-workspace.sh\n'
        )
      );
      expect(forms(r)).toEqual(['staging:odd:missing']);
      expect(w.readSiteUnrecognized(r.sites[0])).toBe(true);
    });

    test('sh, absolute path, folded scalar, script path in step env: each found', () => {
      const r = analyze(
        job(
          '      - name: a\n        run: sh scripts/ci-stage-ocr-workspace.sh\n' +
            '      - name: b\n        run: /home/runner/work/r/r/scripts/ci-stage-ocr-workspace.sh\n' +
            '      - name: c\n        run: >\n          cd .. &&\n          bash ose/scripts/ci-stage-ocr-workspace.sh\n' +
            '      - name: d\n        env:\n          S: scripts/ci-stage-ocr-workspace.sh\n        run: bash "$S"\n'
        )
      );
      expect(r.sites.map((x) => x.step)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('a step reused through a YAML anchor/alias is found at every use', () => {
      const r = analyze(
        `on: push\njobs:\n  a:\n    steps:\n      - &stage\n        name: stage\n        env:\n          ${TOKEN_ENV}: ${READ_FB}\n        run: bash scripts/ci-stage-ocr-workspace.sh\n  b:\n    steps:\n      - *stage\n`
      );
      expect(r.sites.map((x) => `${x.job}:${x.form}`)).toEqual([
        'a:read-fallback',
        'b:read-fallback',
      ]);
      expect(r.occurrences).toHaveLength(2);
    });

    test('npm run <alias> of a package.json script that runs the script is found', () => {
      const r = analyze(
        job('      - name: via npm\n        run: npm run stage:hub\n'),
        'workflow',
        'x.yml',
        [{ file: 'package.json', name: 'stage:hub' }]
      );
      expect(forms(r)).toEqual(['staging:via npm:missing']);
    });

    test('effective env: a workflow-level token counts; a wrong job-level value overrides it', () => {
      const ok = analyze(`env:\n  ${TOKEN_ENV}: ${READ_FB}\n` + job(stage('s')));
      expect(forms(ok)).toEqual(['staging:s:read-fallback']);
      expect(ok.occurrences.map((o) => `${o.level}:${o.form}`)).toEqual(['workflow:read-fallback']);
      const bad = analyze(
        `env:\n  ${TOKEN_ENV}: ${READ_FB}\n` +
          job(stage('s'), `    env:\n      ${TOKEN_ENV}: ${BARE}\n`)
      );
      expect(forms(bad)).toEqual(['staging:s:bare']);
      expect(bad.occurrences.map((o) => `${o.level}:${o.form}`)).toEqual([
        'workflow:read-fallback',
        'job:bare',
      ]);
    });

    test('the new-only read form is recognized; the OLD env name carries no token the script reads', () => {
      const ok = analyze(job(stage('s', READ_NEW)));
      expect(forms(ok)).toEqual(['staging:s:new-only-read']);
      expect(w.READ_FORMS).toContain(ok.sites[0].form);
      const co = analyze(
        job(
          `      - name: hub\n        uses: actions/checkout@v7\n        with:\n          repository: ourCommunityRituals/ourCommunityRituals\n          token: ${READ_NEW}\n`
        )
      );
      expect(forms(co)).toEqual(['checkout:hub:new-only-read']);
      // A step that still sets env OCR_PROPAGATE_TOKEN (even to the new secret) leaves the
      // script's variable unset: a read site with no recognized token.
      const stale = analyze(
        job(
          `      - name: s\n        env:\n          OCR_PROPAGATE_TOKEN: ${READ_NEW}\n        run: bash scripts/ci-stage-ocr-workspace.sh\n`
        )
      );
      expect(forms(stale)).toEqual(['staging:s:missing']);
      expect(w.readSiteUnrecognized(stale.sites[0])).toBe(true);
      expect(stale.sites[0].why).toBe('OCR_HUB_READ is not set');
    });

    test('step env wins over a wrong job env', () => {
      const r = analyze(job(stage('s', READ_FB), `    env:\n      ${TOKEN_ENV}: ${AUTO_FB}\n`));
      expect(forms(r)).toEqual(['staging:s:read-fallback']);
    });

    test('a literal is reported by shape and never printed; an env expression cannot be proven', () => {
      const lit = analyze(job(stage('s', FAKE_LITERAL)));
      expect(forms(lit)).toEqual(['staging:s:literal']);
      expect(JSON.stringify(lit)).not.toContain(FAKE_LITERAL);
      const ex = analyze(
        job(
          `      - name: s\n        env: ${E('fromJSON(vars.E)')}\n        run: bash scripts/ci-stage-ocr-workspace.sh\n`
        )
      );
      expect(forms(ex)).toEqual(['staging:s:unprovable']);
      expect(ex.sites[0].why).toMatch(/expression/);
    });

    test('a composite action that runs the script is never a proven read (no secrets context)', () => {
      const r = analyze(
        `name: x\nruns:\n  using: composite\n  steps:\n    - name: stage\n      shell: bash\n      env:\n        ${TOKEN_ENV}: ${READ_FB}\n      run: bash scripts/ci-stage-ocr-workspace.sh\n`,
        'action'
      );
      expect(forms(r)).toEqual(['staging:stage:composite']);
      expect(w.readSiteUnrecognized(r.sites[0])).toBe(true);
    });

    test('checkouts: hub / OCR-docs matched case-insensitively; own repo is no site, but its old token counts', () => {
      const r = analyze(
        job(
          `      - uses: Actions/Checkout@v7\n        with:\n          Repository: ourcommunityrituals/ocr-docs\n          Token: ${READ_FB}\n` +
            `      - name: hub\n        uses: actions/checkout@v4\n        with:\n          repository: ourCommunityRituals/ourCommunityRituals\n          token: ${BARE}\n` +
            `      - name: self\n        uses: actions/checkout@v7\n        with:\n          token: ${BARE}\n`
        )
      );
      expect(r.sites.map((x) => `${x.kind}:${x.form}`)).toEqual([
        'checkout:read-fallback',
        'checkout:bare',
      ]);
      expect(r.occurrences.map((o) => `${o.step}:${o.form}`)).toEqual([
        'step #1 (unnamed uses Actions/Checkout@v7; give it a name:):read-fallback',
        'hub:bare',
        'self:bare',
      ]);
    });

    test('occurrences at every level and spelling; prose outside an expression fails closed', () => {
      const r = analyze(
        `on: push\nenv:\n  A: ${BARE}\njobs:\n  j:\n    env:\n      B: "${E("secrets['OCR_PROPAGATE_TOKEN']")}"\n    steps:\n` +
          `      - name: s\n        run: echo "${E('secrets.ocr_propagate_token')}"\n` +
          `      - name: i\n        if: secrets.OCR_PROPAGATE_TOKEN != ''\n        run: echo\n` +
          `      - name: prose\n        run: echo "use secrets.OCR_PROPAGATE_TOKEN"\n`
      );
      expect(r.occurrences.map((o) => `${o.level}:${o.id}:${o.form}`)).toEqual([
        'workflow:(workflow) :: (workflow level):bare',
        'job:j :: (job level):bare',
        'step:j :: s:bare',
        'step:j :: i:unrecognized',
        'step:j :: prose:unrecognized',
      ]);
    });

    test('write sites: found by exact file + job + step name; a rename is not found', () => {
      const wf = (stepName, value) =>
        `on: push\njobs:\n  notify:\n    steps:\n      - name: ${stepName}\n        env:\n          GH_TOKEN: ${value}\n        run: gh issue create\n`;
      const F = '.github/workflows/notify-osm-flag-change.yml';
      const right = analyze(wf('Open issue in OSM', NOTIFY_FB), 'workflow', F);
      expect(right.sites.map((x) => `${x.kind}:${x.form}:${w.writeSiteOnExpected(x)}`)).toEqual([
        'write:write-fallback-notify:true',
      ]);
      const wrong = analyze(wf('Open issue in OSM', AUTO_FB), 'workflow', F);
      expect(wrong.sites.map((x) => w.writeSiteOnExpected(x))).toEqual([false]);
      expect(analyze(wf('Open an issue in OSM', NOTIFY_FB), 'workflow', F).sites).toEqual([]);
      expect(analyze(wf('Open issue in OSM', NOTIFY_FB), 'workflow', 'other.yml').sites).toEqual(
        []
      );
    });

    test('a mention of the script outside a staging step is stray; a trigger path filter is not', () => {
      const r = analyze(
        `on:\n  push:\n    paths: ['scripts/ci-stage-ocr-workspace.sh']\njobs:\n  j:\n    env:\n      S: scripts/ci-stage-ocr-workspace.sh\n    steps:\n      - run: echo\n`
      );
      expect(r.mentions.map((m) => `${m.level}:${m.ok}`)).toEqual(['workflow:true', 'job:false']);
    });
  });

  describe('the real tree', () => {
    // The failure message carries the list and the fix, so it reads without the diff.
    const none = (list, header, fix) =>
      expect(list.length, `${header} (${list.length}):\n  - ${list.join('\n  - ')}\n${fix}\n`).toBe(
        0
      );
    const line = (x) => `${key(x)}  ->  ${x.form}: ${x.why}`;

    test('every workflow and composite action parses (an unreadable file cannot be verified)', () => {
      expect(s.parseErrors, s.parseErrors.join('\n')).toEqual([]);
      expect(s.sources.filter((f) => f.startsWith('.github/workflows/')).length).toBeGreaterThan(0);
    });

    test('the enumerator finds staging steps, checkouts and both write sites (no empty pass)', () => {
      const staging = s.sites.filter((x) => x.kind === 'staging');
      const checkouts = s.sites.filter((x) => x.kind === 'checkout');
      const msg = `found ${staging.length} staging step(s) in ${new Set(staging.map((x) => x.file)).size} file(s), ${checkouts.length} checkout(s)`;
      expect(staging.length, msg).toBeGreaterThan(0);
      expect(checkouts.length, msg).toBeGreaterThan(0);
      none(
        w.WRITE_SITES.map((x) => `${x.file} :: ${x.job} :: ${x.step}`).filter(
          (id) => !s.sites.some((x) => x.right === 'write' && key(x) === id)
        ),
        'Named write step(s) not found (renamed, moved or removed)',
        'Fix: if renamed, rename it in WRITE_SITES (scripts/ci/hub-token-wiring.mjs) in the same change.'
      );
    });

    test('every read site uses a read form that names OCR_HUB_READ (never bare)', () => {
      none(
        s.sites.filter((x) => x.right === 'read' && !w.READ_FORMS.includes(x.form)).map(line),
        'Read sites (hub staging, hub / OCR-docs checkouts) not on a read form',
        `Fix: a staging step sets env ${w.SCRIPT_TOKEN_ENV}: ${READ_NEW} (the script reads that variable name, with no fallback); a checkout sets with.token: ${READ_NEW}. A composite action cannot read secrets: run the script from a workflow step.`
      );
    });

    test('the write sites use write forms, each on its decided token', () => {
      const writes = s.sites.filter((x) => x.right === 'write');
      const isWriteForm = (f) =>
        f.startsWith('write-fallback-') || /^new-only-(automation|notify)$/.test(f);
      none(
        writes.filter((x) => !isWriteForm(x.form)).map(line),
        'Write sites not on a write form',
        `Fix: GH_TOKEN names the site's write secret, e.g. ${NOTIFY_FB}.`
      );
      none(
        writes.filter((x) => !w.writeSiteOnExpected(x)).map(line),
        'Write sites on the wrong token (conformance: OCR_AUTOMATION_WRITE, notify-osm: OCR_NOTIFY_OSM)',
        'Fix: point the step at its decided secret (WRITE_SITES.expected in scripts/ci/hub-token-wiring.mjs).'
      );
    });

    test('the old token and the write secrets appear only at their sites, at step level, in known forms', () => {
      const siteIds = (right) => new Set(s.sites.filter((x) => x.right === right).map(key));
      const reads = siteIds('read');
      const writes = siteIds('write');
      const usesOld = ['bare', ...w.FALLBACK_FORMS];
      none(
        s.occurrences
          .filter((o) => usesOld.includes(o.form))
          .filter((o) => o.level !== 'step' || !(reads.has(key(o)) || writes.has(key(o))))
          .map((o) => `${key(o)} (${o.level} level, ${o.form})`),
        'secrets.OCR_PROPAGATE_TOKEN named outside a read or write site step',
        'Fix: name it only in the env / with of the read or write step that needs it. A new write use is an owner decision and gets its own token.'
      );
      none(
        s.occurrences
          .filter((o) => /^write-fallback-|^new-only-(automation|notify)$/.test(o.form))
          .filter((o) => o.level !== 'step' || !writes.has(key(o)))
          .map((o) => `${key(o)} (${o.level} level, ${o.form})`),
        'A write secret named outside the two write sites',
        'Fix: a new write use is an owner decision (OSE-1695); add it to WRITE_SITES only with that decision.'
      );
      none(
        s.occurrences
          .filter((o) => o.form === 'unrecognized')
          .map((o) => `${key(o)} (${o.level} level)`),
        'Token expressions in no recognized form',
        `Fix: use a recognized form; for a read, the new secret alone: ${READ_NEW}.`
      );
    });

    test('every mention of the staging script is an invocation or classified', () => {
      none(
        s.mentions
          .filter((m) => !m.ok)
          .map((m) => `${m.file} :: ${m.job} :: ${m.step} at ${m.where}`),
        'Workflow mentions of ci-stage-ocr-workspace outside a staging step',
        'Fix: run the script from a step (its run or step env), or drop the mention.'
      );
      const g = spawnSync(
        'git',
        [
          'grep',
          '--untracked',
          '-l',
          '-e',
          'ci-stage-ocr-workspace',
          '--',
          '.',
          ':!.github/workflows',
          ':!tests',
          ':!docs',
          ':!workers/*/docs',
          ':!.claude',
          ':!*.md',
        ],
        { cwd: ROOT, encoding: 'utf8' }
      );
      expect(g.status, `git grep failed: ${g.stderr}`).toBe(0);
      const found = g.stdout.split(/\r?\n/).filter(Boolean).sort();
      none(
        found.filter((f) => !(f in KNOWN_MENTIONS)),
        'Unclassified file(s) mentioning ci-stage-ocr-workspace outside workflows',
        'Fix: if the file RUNS the script, that run must happen in a workflow step with a read token; then add the file to KNOWN_MENTIONS in tests/integration/adr008-wiring.test.js with one line saying what the mention is.'
      );
      none(
        Object.keys(KNOWN_MENTIONS).filter((f) => !found.includes(f)),
        'KNOWN_MENTIONS entries that no longer mention the script',
        'Fix: delete those entries.'
      );
      none(
        s.aliases.map((a) => `${a.file}: npm run ${a.name}`),
        'package.json scripts that run the staging script',
        'Fix: call scripts/ci-stage-ocr-workspace.sh directly from the workflow step, or classify the alias here with a reason.'
      );
    });

    test('the staging script authenticates with OCR_HUB_READ, never the old name, and the enumerator agrees', () => {
      const script = readFileSync(join(ROOT, 'scripts', 'ci-stage-ocr-workspace.sh'), 'utf8');
      const m = /x-access-token:\$\{([A-Z_]+)\}/.exec(script);
      expect(m, 'the script builds its auth header from one env var').not.toBeNull();
      expect(
        m[1],
        'scripts/ci-stage-ocr-workspace.sh now authenticates with another variable: update SCRIPT_TOKEN_ENV in scripts/ci/hub-token-wiring.mjs in the same change'
      ).toBe(w.SCRIPT_TOKEN_ENV);
      expect(w.SCRIPT_TOKEN_ENV, 'the script reads the read secret by its own name').toBe(
        w.READ_NAME
      );
      expect(TOKEN_ENV).toBe(w.SCRIPT_TOKEN_ENV);
      // No expansion of the old variable anywhere (prose naming it in a comment is fine): a
      // `${OCR_HUB_READ:-${OCR_PROPAGATE_TOKEN}}` style fallback would put the write PAT back.
      const code = script
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');
      expect(
        code.match(/\$\{?!?OCR_PROPAGATE_TOKEN\b/g) || [],
        'scripts/ci-stage-ocr-workspace.sh expands OCR_PROPAGATE_TOKEN: the read path has no fallback to the write-capable PAT (OSE-1695)'
      ).toEqual([]);
    });
  });
});

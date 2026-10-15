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

  // ── 6. Job-level environments (OSE-1695) ──────────────────────────────────
  // The write tokens are environment secrets of main-automation (branch main only). A job
  // sees them only when it declares that environment, so: both write sites' jobs declare
  // exactly main-automation, no job outside MAIN_AUTOMATION_JOBS may declare it, and every
  // job-level environment anywhere resolves to a name in ALLOWED_ENVIRONMENTS (a typo would
  // make GitHub create a new, unprotected environment on first use).
  describe('job-level environments (OSE-1695): main-automation users and allowed names', () => {
    const CONF = '.github/workflows/conformance-report.yml';
    const NOTIFY = '.github/workflows/notify-osm-flag-change.yml';
    const DRIFT = '.github/workflows/branch-protection-drift.yml';
    const envLine = (env) => (env ? `    environment: ${env}\n` : '');
    const writeWf = (jobName, stepName, value, env) =>
      `on: push\njobs:\n  ${jobName}:\n${envLine(env)}    steps:\n      - name: ${stepName}\n        env:\n          GH_TOKEN: ${value}\n        run: gh api\n`;
    const plainWf = (jobs) =>
      'on: push\njobs:\n' +
      Object.entries(jobs)
        .map(([j, env]) => `  ${j}:\n${envLine(env)}    steps:\n      - run: echo\n`)
        .join('');
    // A scan-shaped result over synthetic files, through the real analyzeDoc.
    const scanOf = (files) => {
      const out = { sites: [], environments: [] };
      for (const [file, text] of Object.entries(files)) {
        const r = analyze(text, 'workflow', file);
        out.sites.push(...r.sites);
        out.environments.push(...r.environments);
      }
      return out;
    };
    const MA = 'main-automation';
    const good = (overrides = {}) =>
      scanOf({
        [CONF]: writeWf('generate', 'Open/update the conformance-refresh PR', AUTO_FB, MA),
        [NOTIFY]: writeWf('notify', 'Open issue in OSM', NOTIFY_FB, MA),
        [DRIFT]: plainWf({ 'required-checks': '', 'full-settings': MA }),
        ...overrides,
      });

    describe('negative controls: the detectors can fail', () => {
      test('environment values: string, { name }, provable expressions; everything else fails closed', () => {
        const r = (v) => w.resolveEnvironment(v).names;
        expect(r(undefined)).toEqual([]);
        expect(r('staging')).toEqual(['staging']);
        expect(r({ name: 'production', url: E('env.PROD_BASE_URL') })).toEqual(['production']);
        expect(r(E("github.ref == 'refs/heads/main' && 'production' || 'staging'"))).toEqual([
          'production',
          'staging',
        ]);
        expect(r(E("(a && 'x') || b && c && 'y' || ('z')"))).toEqual(['x', 'y', 'z']);
        expect(r(E("'a||b' || 'c'"))).toEqual(['a||b', 'c']); // quotes are respected
        expect(
          r({ name: E("startsWith(github.ref, 'refs/tags/') && 'production' || 'staging'") })
        ).toEqual(['production', 'staging']);
        // Unprovable: a context value, a value fallback, a chain that can end falsy, a call.
        expect(r(E('inputs.target'))).toBeNull();
        expect(r(E("inputs.target || 'staging'"))).toBeNull();
        expect(r(E("github.ref == 'refs/heads/main' && 'production'"))).toBeNull();
        expect(r(E("format('{0}', 'staging')"))).toBeNull();
        expect(r(E("'staging' || ''"))).toBeNull();
        expect(r(E("'unbalanced"))).toBeNull();
        expect(r('pre-' + E("'staging'"))).toBeNull();
        expect(r({ url: 'https://example.invalid' })).toBeNull();
        expect(r(42)).toBeNull();
        expect(r('')).toBeNull();
      });

      test('the name gate: a typo, a hardening step name and an unprovable value are red, by name only', () => {
        const envs = analyze(
          plainWf({
            ok: 'staging',
            typo: 'main-automaton',
            step: 'production-gate',
            unknown: E('inputs.private_target_name'),
            ternary: E("github.ref == 'refs/heads/main' && 'production' || 'staging'"),
          })
        ).environments;
        const p = w.environmentNameProblems(envs);
        expect(p).toHaveLength(3);
        expect(p[0]).toMatch(
          /x\.yml :: typo :: \(job level\): environment "main-automaton" is not one of/
        );
        expect(p[1]).toMatch(/step :: \(job level\): environment "production-gate" is not one of/);
        expect(p[2]).toMatch(
          /unknown :: \(job level\): an expression whose possible names cannot be proven \(unrecognized/
        );
        expect(p.join('\n')).not.toContain('private_target_name'); // the value is never printed
      });

      test('a composite action that declares an environment is red (it has no job level)', () => {
        const r = analyze(
          'name: x\nenvironment: staging\nruns:\n  using: composite\n  steps:\n    - run: echo\n      shell: bash\n',
          'action',
          '.github/actions/x/action.yml'
        );
        expect(w.environmentNameProblems(r.environments)).toEqual([
          '.github/actions/x/action.yml :: (composite action) :: (action level): a composite action cannot declare an environment (unrecognized; it must resolve to one of staging, production, copilot, main-automation)',
        ]);
      });

      test('a write site records whether its job declares exactly main-automation', () => {
        const at = (env) =>
          analyze(writeWf('notify', 'Open issue in OSM', NOTIFY_FB, env), 'workflow', NOTIFY)
            .sites[0];
        expect(at(MA).inMainAutomation).toBe(true);
        expect(at(`{ name: ${MA} }`).inMainAutomation).toBe(true);
        expect(at('').inMainAutomation).toBe(false);
        expect(at('staging').inMainAutomation).toBe(false);
        expect(
          at(E(`github.ref == 'refs/heads/main' && '${MA}' || 'staging'`)).inMainAutomation
        ).toBe(false);
      });

      test('main-automation users: missing on a write site, an extra job, or a stale list entry is red', () => {
        expect(w.mainAutomationProblems(good())).toEqual([]);
        // (a) the conformance job loses it: the write site and the listed job are both named.
        const lost = w.mainAutomationProblems(
          good({
            [CONF]: writeWf('generate', 'Open/update the conformance-refresh PR', AUTO_FB, ''),
          })
        );
        expect(lost).toEqual([
          `write site ${CONF} :: generate :: Open/update the conformance-refresh PR: its job declares no environment, not exactly environment ${MA}`,
          `${CONF} :: generate: listed in MAIN_AUTOMATION_JOBS but declares no environment, not exactly ${MA}`,
        ]);
        // (c) / (e) another job declares it, in any case spelling or through an expression.
        for (const env of [
          MA,
          'Main-Automation',
          E(`github.ref == 'refs/heads/main' && '${MA}' || 'staging'`),
        ]) {
          const extra = w.mainAutomationProblems(
            good({ [DRIFT]: plainWf({ 'required-checks': env, 'full-settings': MA }) })
          );
          expect(extra, String(env)).toEqual([
            `${DRIFT} :: required-checks :: (job level): declares ${MA} but is not in MAIN_AUTOMATION_JOBS (its secrets are write tokens; a new user is an owner decision, OSE-1695)`,
          ]);
        }
        // A listed job that no longer declares it is a stale entry.
        expect(
          w.mainAutomationProblems(
            good({ [DRIFT]: plainWf({ 'required-checks': '', 'full-settings': '' }) })
          )
        ).toEqual([
          `${DRIFT} :: full-settings: listed in MAIN_AUTOMATION_JOBS but declares no environment, not exactly ${MA}`,
        ]);
      });
    });

    describe('the real tree', () => {
      const none = (list, header, fix) =>
        expect(
          list.length,
          `${header} (${list.length}):\n  - ${list.join('\n  - ')}\n${fix}\n`
        ).toBe(0);

      test('the allowed names are the four environments, tied to scripts/hardening/apply-github.mjs (OSE-1693)', async () => {
        // Changing the allowed set means changing this line too, in the same reviewed change.
        expect([...w.ALLOWED_ENVIRONMENTS]).toEqual([
          'staging',
          'production',
          'copilot',
          'main-automation',
        ]);
        const g = await import(
          pathToFileURL(join(ROOT, 'scripts', 'hardening', 'apply-github.mjs')).href
        );
        expect(g.MAIN_AUTOMATION, 'apply-github creates the environment this gate allows').toBe(
          w.MAIN_AUTOMATION_ENV
        );
        // Its other step names are steps, never environments.
        expect(
          g.STEP_NAMES.filter((n) => n !== g.MAIN_AUTOMATION && w.ALLOWED_ENVIRONMENTS.includes(n))
        ).toEqual([]);
        expect(g.STEP_NAMES).toEqual(
          expect.arrayContaining(['release-tag-ruleset', 'production-gate'])
        );
      });

      test('every job-level environment resolves to an allowed name', () => {
        const names = new Set(s.environments.flatMap((e) => e.names || []));
        // Anti-vacuity: the deploy jobs and the main-automation jobs are found.
        expect([...names]).toEqual(
          expect.arrayContaining(['staging', 'production', 'main-automation'])
        );
        none(
          w.environmentNameProblems(s.environments),
          'Job-level environments outside ALLOWED_ENVIRONMENTS (or unprovable)',
          'Fix: use one of the allowed names. A new environment is created and protected by scripts/hardening/apply-github.mjs first, then added to ALLOWED_ENVIRONMENTS in scripts/ci/hub-token-wiring.mjs (OSE-1693).'
        );
      });

      test('both write sites declare exactly main-automation; no other job may declare it', () => {
        expect(s.sites.filter((x) => x.right === 'write' && x.inMainAutomation)).toHaveLength(
          w.WRITE_SITES.length
        );
        none(
          w.mainAutomationProblems(s),
          'main-automation users out of line with MAIN_AUTOMATION_JOBS',
          `Fix: a write site's job declares \`environment: ${w.MAIN_AUTOMATION_ENV}\`; any other job drops it. A new user is an owner decision (OSE-1695): add it to MAIN_AUTOMATION_JOBS in scripts/ci/hub-token-wiring.mjs with that decision.`
        );
      });
    });
  });

  // ── 7. Checkouts in token-holding jobs (OSE-1695) ─────────────────────────
  // actions/checkout persists the job's GITHUB_TOKEN as an http extraheader for github.com
  // unless `persist-credentials: false`. git sends that header on a push even when the push
  // URL carries another token, so the conformance push used the read-only GITHUB_TOKEN and
  // got 403 "Write access to repository not granted" with either write token. So: in every
  // job that is a write site's job, is in MAIN_AUTOMATION_JOBS, or may declare main-automation,
  // every actions/checkout step (any version, any repository) sets persist-credentials to the
  // YAML boolean false. Out of scope: checkouts inside composite actions (a composite action has
  // no job level or environment of its own; .github/actions does not exist today) and reusable
  // workflows called with `uses:` at job level.
  describe('checkouts in write-site and main-automation jobs do not persist credentials (OSE-1695)', () => {
    const CONF = '.github/workflows/conformance-report.yml';
    const MA = 'main-automation';
    const PERSIST_KEY = 'persist-credentials';
    const co = (name, uses, withLines = []) =>
      `      - name: ${name}\n        uses: ${uses}\n` +
      (withLines.length
        ? `        with:\n${withLines.map((l) => `          ${l}\n`).join('')}`
        : '');
    const wf = (jobName, env, steps) =>
      `on: push\njobs:\n  ${jobName}:\n` +
      (env ? `    environment: ${env}\n` : '') +
      '    steps:\n' +
      steps.join('');
    const checkoutsOf = (text, file = CONF, kind = 'workflow') =>
      analyze(text, kind, file).checkouts;
    describe('negative controls: the detector can fail', () => {
      test('only the YAML boolean false passes; missing, true, a string, an expression and a non-mapping are red', () => {
        const shape = (v) => w.persistCredentialsShape(v);
        expect(shape({ 'fetch-depth': 1, [PERSIST_KEY]: false })).toEqual({
          ok: true,
          shape: 'false',
        });
        expect(shape({ 'Persist-Credentials': false }).ok).toBe(true); // inputs ignore case
        expect(shape(undefined)).toEqual({
          ok: false,
          shape: 'not set (no with:), so it defaults to true',
        });
        expect(shape({ 'fetch-depth': 1 })).toEqual({
          ok: false,
          shape: 'not set, so it defaults to true',
        });
        expect(shape({ [PERSIST_KEY]: true }).ok).toBe(false);
        expect(shape({ [PERSIST_KEY]: 'false' }).ok).toBe(false);
        expect(shape({ [PERSIST_KEY]: E('false') })).toEqual({
          ok: false,
          shape: 'an expression (not the literal false)',
        });
        expect(shape({ [PERSIST_KEY]: 0 }).ok).toBe(false);
        expect(shape(E('fromJSON(vars.W)')).ok).toBe(false);
      });

      test('a write-site job: missing key, true and an expression are each red, by name, with the fix', () => {
        const text = wf('generate', MA, [
          co('Checkout', 'actions/checkout@v4', ['fetch-depth: 1']),
          co('Checkout true', 'actions/checkout@v4', [`${PERSIST_KEY}: true`]),
          co('Checkout expr', 'actions/checkout@v4', [
            `${PERSIST_KEY}: ${E('inputs.private_flag_name')}`,
          ]),
          co('Checkout ok', 'actions/checkout@v4', ['fetch-depth: 1', `${PERSIST_KEY}: false`]),
        ]);
        const p = w.checkoutPersistenceProblems({ checkouts: checkoutsOf(text) });
        expect(p).toEqual([
          `${CONF} :: generate :: Checkout: persist-credentials is not set, so it defaults to true. Fix: ${w.CHECKOUT_PERSIST_FIX}.`,
          `${CONF} :: generate :: Checkout true: persist-credentials is true. Fix: ${w.CHECKOUT_PERSIST_FIX}.`,
          `${CONF} :: generate :: Checkout expr: persist-credentials is an expression (not the literal false). Fix: ${w.CHECKOUT_PERSIST_FIX}.`,
        ]);
        expect(p.join('\n')).not.toContain('private_flag_name'); // a value is never printed
        expect(w.CHECKOUT_PERSIST_FIX).toContain('`persist-credentials: false`');
      });

      test('any version and any repository: a sha pin, no ref, odd case, and a repository: checkout are all checked', () => {
        const text = wf('generate', MA, [
          co('sha', `actions/checkout@${'a'.repeat(40)}`),
          co('noref', 'actions/checkout'),
          co('case', 'Actions/Checkout@v7', [`${PERSIST_KEY}: false`]),
          co('brain', 'actions/checkout@v4', [
            'repository: ourCommunityRituals/OCR-docs',
            `token: ${READ_NEW}`,
          ]),
          co('not a checkout', 'actions/setup-node@v4'),
        ]);
        expect(checkoutsOf(text).map((c) => `${c.step}:${c.ok}`)).toEqual([
          'sha:false',
          'noref:false',
          'case:true',
          'brain:false',
        ]);
      });

      test('pre-fix shape: only the OCR-docs checkout sets it, the repo checkout does not: red', () => {
        const text = wf('generate', MA, [
          co('Checkout', 'actions/checkout@v4', ['fetch-depth: 1']),
          co('Checkout OCR-docs brain (read-only)', 'actions/checkout@v4', [
            'repository: ourCommunityRituals/OCR-docs',
            `token: ${READ_NEW}`,
            `${PERSIST_KEY}: false`,
          ]),
        ]);
        expect(w.checkoutPersistenceProblems({ checkouts: checkoutsOf(text) })).toHaveLength(1);
        expect(
          checkoutsOf(text)
            .filter((c) => !c.ok)
            .map((c) => c.step)
        ).toEqual(['Checkout']);
      });

      test('a checkout added to an unlisted main-automation job (any case, or via an expression) is checked', () => {
        for (const env of [
          MA,
          'Main-Automation',
          E(`github.ref == 'refs/heads/main' && '${MA}' || 'staging'`),
        ]) {
          const c = checkoutsOf(wf('newjob', env, [co('co', 'actions/checkout@v7')]), 'new.yml');
          expect(
            c.map((x) => `${x.file} :: ${x.id}:${x.ok}`),
            String(env)
          ).toEqual(['new.yml :: newjob :: co:false']);
        }
      });

      test('an unprovable environment fails closed (checked); no environment, or another one, is out of scope', () => {
        const unprovable = checkoutsOf(
          wf('j', E('inputs.target'), [co('co', 'actions/checkout@v7')]),
          'new.yml'
        );
        expect(unprovable.map((x) => x.ok)).toEqual([false]);
        expect(checkoutsOf(wf('j', '', [co('co', 'actions/checkout@v7')]), 'new.yml')).toEqual([]);
        expect(
          checkoutsOf(wf('j', 'staging', [co('co', 'actions/checkout@v7')]), 'new.yml')
        ).toEqual([]);
      });

      test('a listed job is checked even if it lost its environment (the listing alone is enough)', () => {
        const c = checkoutsOf(wf('generate', '', [co('Checkout', 'actions/checkout@v4')]));
        expect(c.map((x) => `${x.id}:${x.ok}`)).toEqual(['generate :: Checkout:false']);
      });

      test('composite actions are out of scope (no job level): their checkouts are not recorded', () => {
        const r = analyze(
          'name: x\nruns:\n  using: composite\n  steps:\n    - name: co\n      uses: actions/checkout@v7\n',
          'action',
          '.github/actions/x/action.yml'
        );
        expect(r.checkouts).toEqual([]);
      });
    });

    describe('the real tree', () => {
      const none = (list, header, fix) =>
        expect(
          list.length,
          `${header} (${list.length}):\n  - ${list.join('\n  - ')}\n${fix}\n`
        ).toBe(0);
      const idOf = (c) => `${c.file} :: ${c.id}`;

      test('every write-site job and main-automation job is scanned, and its checkouts found (no empty pass)', () => {
        const jobs = new Set(s.checkouts.map((c) => `${c.file} :: ${c.job}`));
        const missing = [...w.WRITE_SITES, ...w.MAIN_AUTOMATION_JOBS]
          .map((j) => `${j.file} :: ${j.job}`)
          .filter((j) => !jobs.has(j));
        none(
          missing,
          'Write-site / main-automation jobs with no checkout found (the scan could pass vacuously)',
          'Fix: if such a job truly has no checkout, say so here; otherwise the detector is broken.'
        );
        // conformance: the repo checkout and the OCR-docs checkout; notify: one; drift: one.
        expect(s.checkouts.map(idOf)).toEqual(
          expect.arrayContaining([
            `${CONF} :: generate :: Checkout`,
            `${CONF} :: generate :: Checkout OCR-docs brain (read-only)`,
            '.github/workflows/notify-osm-flag-change.yml :: notify :: step #1 (unnamed uses actions/checkout@v7; give it a name:)',
            '.github/workflows/branch-protection-drift.yml :: full-settings :: step #1 (unnamed uses actions/checkout@v7; give it a name:)',
          ])
        );
        expect(s.checkouts.length).toBeGreaterThanOrEqual(4);
      });

      test('no checkout in a write-site or main-automation job persists credentials (zero exceptions)', () => {
        none(
          w.checkoutPersistenceProblems(s),
          'Checkouts in a write-site or main-automation job that persist credentials (git would send the job GITHUB_TOKEN instead of the write token)',
          `Fix: ${w.CHECKOUT_PERSIST_FIX}.`
        );
        expect(s.checkouts.every((c) => c.ok)).toBe(true);
      });
    });
  });
});

/* eslint-disable security/detect-non-literal-regexp -- reads the repo's own workflow and builds patterns from its env names */
/**
 * The stock workflow (.github/workflows/stock-data-full.yml): its trigger
 * (manual only), its job chain and where its secrets may appear. Owner,
 * 2026-11-05: no nightly search; the site loads from the committed seed.
 * Owner, 2026-11-06: one staging site. The seed loads into stg. itself, so the
 * workflow deploys nothing, has no Access gate, and uses the staging secrets the
 * Bruno contract run already uses.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_PATH = join(ROOT, '.github', 'workflows', 'stock-data-full.yml');
const wf = yaml.load(readFileSync(WF_PATH, 'utf8'));
const jobs = wf.jobs || {};
const CHAIN = ['seed', 'build', 'check-swap'];
const needsOf = (job) => {
  const n = jobs[job] && jobs[job].needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
};
const stepsOf = (job) => (jobs[job] && jobs[job].steps) || [];

describe('triggers and posture', () => {
  test('runs on manual dispatch only: no schedule, no other trigger', () => {
    const on = wf.on ?? wf[true];
    expect(Object.keys(on)).toEqual(['workflow_dispatch']);
    expect(readFileSync(WF_PATH, 'utf8')).not.toMatch(/^\s*(schedule|cron)\s*:/m);
  });

  test('no search is left: no Claude action, no model key, no spend cap, no enable switch', () => {
    const text = readFileSync(WF_PATH, 'utf8');
    for (const gone of [
      'anthropics/claude-code-action',
      'ANTHROPIC_API_KEY',
      'STOCK_SEARCH_MAX_USD',
      'STOCK_FULL_ENABLED',
      'max-budget-usd',
      'prepare-search',
      'search-output',
      'run-day.mjs validate',
    ]) {
      expect(text, gone).not.toContain(gone);
    }
    expect(jobs.search).toBeUndefined();
    expect(jobs.validate).toBeUndefined();
  });

  test('permissions are contents: read, and no job widens them', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    for (const job of Object.keys(jobs)) expect(jobs[job].permissions, job).toBeUndefined();
  });

  test('one run at a time, never cancelled by the next', () => {
    expect(wf.concurrency).toEqual({ group: 'stock-data-full', 'cancel-in-progress': false });
  });

  test('every job is on ubuntu-24.04', () => {
    for (const job of Object.keys(jobs)) expect(jobs[job]['runs-on'], job).toBe('ubuntu-24.04');
  });

  test('every job has a timeout', () => {
    for (const job of Object.keys(jobs)) {
      expect(jobs[job]['timeout-minutes'], job).toBeGreaterThan(0);
    }
  });
});

describe('the job chain', () => {
  test('seed → build → check-swap', () => {
    expect(Object.keys(jobs)).toEqual(CHAIN);
    expect(needsOf('seed')).toEqual([]);
    for (let i = 1; i < CHAIN.length; i++) expect(needsOf(CHAIN[i])).toEqual([CHAIN[i - 1]]);
  });

  test('only check-swap overrides the default success() gate, and never on a skip or cancel', () => {
    for (const job of CHAIN.slice(0, -1)) expect(jobs[job].if, job).toBeUndefined();
    const cond = jobs['check-swap'].if;
    expect(cond).toContain('!cancelled()');
    expect(cond).toContain("needs.build.result == 'success'");
    expect(cond).toContain("needs.build.result == 'failure'");
    expect(cond).not.toContain('always()');
  });
});

describe('one staging site (owner 2026-11-06)', () => {
  const text = readFileSync(WF_PATH, 'utf8');
  const code = text
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  test('deploys nothing and migrates nothing: stg runs main as T1 deployed it', () => {
    expect(code).not.toMatch(/wrangler\s+deploy/);
    expect(code).not.toMatch(/migrations\s+apply/);
    expect(jobs.deploy).toBeUndefined();
  });

  test('has no Access gate and names no second site', () => {
    expect(jobs['access-gate']).toBeUndefined();
    expect(code).not.toMatch(/stg-full|staging-full|STG_FULL/);
  });

  test('build and check-swap use the staging secrets the Bruno run uses', () => {
    for (const job of ['build', 'check-swap']) {
      const step = stepsOf(job).find((s) => /run-day\.mjs/.test(String(s.run || '')));
      expect(step.env.ADMIN_KEY, job).toBe('${{ secrets.ADMIN_KEY }}');
      expect(step.env.CF_ACCESS_CLIENT_ID, job).toBe('${{ secrets.CF_ACCESS_CLIENT_ID }}');
      expect(step.env.CF_ACCESS_CLIENT_SECRET, job).toBe('${{ secrets.CF_ACCESS_CLIENT_SECRET }}');
    }
  });

  test('every wrangler command in the workflow targets --env staging', () => {
    for (const line of code.split('\n').filter((l) => /\bwrangler\b/.test(l))) {
      expect(line).toMatch(/--env staging(\s|$)/);
    }
  });
});

describe('secrets', () => {
  test('no job but build and check-swap names the Cloudflare token or account', () => {
    const CLOUDFLARE_JOBS = ['build', 'check-swap'];
    for (const job of Object.keys(jobs)) {
      const text = JSON.stringify(jobs[job]);
      const named = /secrets\.CLOUDFLARE_API_TOKEN|secrets\.CLOUDFLARE_ACCOUNT_ID/.test(text);
      expect(named, job).toBe(CLOUDFLARE_JOBS.includes(job));
    }
    const steps = CLOUDFLARE_JOBS.flatMap(stepsOf);
    for (const s of steps) {
      if (!/secrets\.CLOUDFLARE/.test(JSON.stringify(s))) continue;
      expect(JSON.stringify(s.env), s.name).toMatch(/secrets\.CLOUDFLARE_API_TOKEN_OSE/);
    }
    // in build, the step that runs the build holds them, and no other
    const held = stepsOf('build').filter((s) => /secrets\.CLOUDFLARE/.test(JSON.stringify(s)));
    expect(held).toHaveLength(1);
    expect(held[0].run).toBe('node scripts/stock/run-day.mjs build');
    expect(held[0].env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN_OSE }}');
    expect(held[0].env.CLOUDFLARE_ACCOUNT_ID).toBe('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
  });

  test('secrets reach a step only through env:, never through with:', () => {
    for (const job of Object.keys(jobs)) {
      expect(JSON.stringify(jobs[job].env || {}), job).not.toContain('secrets.');
      for (const s of stepsOf(job)) {
        expect(String(s.run || ''), `${job}/${s.name}`).not.toContain('secrets.');
        expect(JSON.stringify(s.with || {}), `${job}/${s.name}`).not.toContain('secrets.');
      }
    }
    expect(JSON.stringify(wf.env)).not.toContain('secrets.');
  });

  test('the seed job holds no secret and reads no variable', () => {
    expect(JSON.stringify(jobs.seed)).not.toMatch(/secrets\.|vars\./);
  });

  test('no step echoes a secret or traces its shell', () => {
    for (const job of Object.keys(jobs)) {
      for (const s of stepsOf(job)) {
        const run = String(s.run || '');
        expect(run, `${job}/${s.name}`).not.toMatch(/set\s+-[a-z]*x|set\s+-o\s+xtrace/);
        const secretVars = Object.entries(s.env || {})
          .filter(([, v]) => /secrets\./.test(String(v)))
          .map(([k]) => k);
        for (const name of secretVars) {
          expect(run, `${job}/${s.name} prints ${name}`).not.toMatch(
            new RegExp(`(echo|printf)[^\\n]*\\$\\{?${name}\\b`)
          );
        }
      }
    }
  });
});

describe('checkout', () => {
  test('every job checks out the triggering ref: none pins another', () => {
    let checkouts = 0;
    for (const job of Object.keys(jobs)) {
      for (const s of stepsOf(job)) {
        if (!/^actions\/checkout@/.test(s.uses || '')) continue;
        checkouts += 1;
        expect((s.with || {}).ref, `${job} checkout`).toBeUndefined();
        expect((s.with || {}).repository, `${job} checkout`).toBeUndefined();
      }
    }
    expect(checkouts).toBe(CHAIN.length);
  });
});

describe('seed', () => {
  const steps = stepsOf('seed');

  test('re-bases the committed seed and hands the build its three files', () => {
    expect(steps.some((s) => s.run === 'node scripts/stock/run-day.mjs seed')).toBe(true);
    const upload = steps.find((s) => /^actions\/upload-artifact@/.test(s.uses || ''));
    expect(upload.with.name).toBe('stock-seeded');
    expect(upload.with.path.trim().split('\n')).toEqual([
      'stock-out/accepted.json',
      'stock-out/businesses.json',
      'stock-out/load.json',
    ]);
    expect(upload.with['if-no-files-found']).toBe('error');
    const download = stepsOf('build').find((s) =>
      /^actions\/download-artifact@/.test(s.uses || '')
    );
    expect(download.with).toEqual({ name: 'stock-seeded', path: 'stock-out' });
  });

  test('stock-out/ is git-ignored, so its files never get committed by accident', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('stock-out/');
  });
});

describe('build and check-swap', () => {
  test('each job runs its run-day subcommand', () => {
    const run = (job) =>
      stepsOf(job)
        .map((s) => String(s.run || ''))
        .join('\n');
    expect(run('seed')).toContain('node scripts/stock/run-day.mjs seed');
    expect(run('build')).toContain('node scripts/stock/run-day.mjs build');
    expect(run('check-swap')).toContain('node scripts/stock/run-day.mjs check-swap');
  });

  test('a failed build still hands its manifest on', () => {
    const upload = stepsOf('build').find((s) => /^actions\/upload-artifact@/.test(s.uses || ''));
    expect(upload.if).toBe('always()');
    expect(upload.with.name).toBe('stock-manifest');
    const swap = stepsOf('check-swap').find((s) => /run-day\.mjs check-swap/.test(s.run || ''));
    expect(swap.env.BUILD_RESULT).toBe('${{ needs.build.result }}');
  });

  test('the build installs the lockfile wrangler before it runs, to list its manifest in R2', () => {
    const steps = stepsOf('build');
    const installAt = steps.findIndex(
      (s) =>
        s['working-directory'] === '${{ env.WORKER_DIR }}' && /\bnpm ci\b/.test(String(s.run || ''))
    );
    const buildAt = steps.findIndex((s) => /run-day\.mjs build/.test(String(s.run || '')));
    expect(installAt).toBeGreaterThanOrEqual(0);
    expect(installAt).toBeLessThan(buildAt);
  });

  test('a slow build fails its step, not the job: the result is failure, so check-swap runs', () => {
    const build = stepsOf('build').find((s) => /run-day\.mjs build/.test(s.run || ''));
    expect(build['timeout-minutes']).toBe(25);
    expect(jobs.build['timeout-minutes']).toBe(30);
    expect(build['timeout-minutes']).toBeLessThan(jobs.build['timeout-minutes']);
  });

  test('a missing manifest artifact still lets run-day report it red; nothing else bypasses a failure', () => {
    const steps = stepsOf('check-swap');
    const downloadAt = steps.findIndex((s) => /^actions\/download-artifact@/.test(s.uses || ''));
    const swapAt = steps.findIndex((s) => /run-day\.mjs check-swap/.test(s.run || ''));
    expect(swapAt).toBe(downloadAt + 1);
    expect(steps[downloadAt].id).toBe('download');
    expect(steps[swapAt].if).toBe(
      "${{ !cancelled() && (success() || steps.download.outcome == 'failure') }}"
    );
    for (const job of Object.keys(jobs)) {
      for (const s of stepsOf(job)) {
        expect(s['continue-on-error'], `${job}/${s.name}`).toBeUndefined();
      }
    }
  });
});

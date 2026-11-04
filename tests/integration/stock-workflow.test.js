/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- reads the repo's own workflow, writes temp scripts, and builds patterns from its env names */
/**
 * The morning stock workflow for the full staging site
 * (.github/workflows/stock-data-full.yml): its triggers, its job chain, its
 * Access gate and where its secrets may appear.
 */
const { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_PATH = join(ROOT, '.github', 'workflows', 'stock-data-full.yml');
const wf = yaml.load(readFileSync(WF_PATH, 'utf8'));
const jobs = wf.jobs || {};
const CHAIN = ['access-gate', 'deploy', 'search', 'validate', 'build', 'check-swap'];
const needsOf = (job) => {
  const n = jobs[job] && jobs[job].needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
};
const stepsOf = (job) => (jobs[job] && jobs[job].steps) || [];
// The workflow's own bash steps run under a real bash with stubbed commands.
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const BASH = process.platform === 'win32' ? (existsSync(GIT_BASH) ? GIT_BASH : null) : 'bash';

describe('triggers and posture', () => {
  test('runs on the 11:00 UTC schedule and on manual dispatch, nothing else', () => {
    const on = wf.on ?? wf[true];
    expect(Object.keys(on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(on.schedule).toEqual([{ cron: '0 11 * * *' }]);
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

  test('search has a 30-minute timeout', () => {
    expect(jobs.search['timeout-minutes']).toBe(30);
  });
});

describe('the job chain', () => {
  test('access-gate → deploy → search → validate → build → check-swap', () => {
    expect(Object.keys(jobs)).toEqual(CHAIN);
    expect(needsOf('access-gate')).toEqual([]);
    for (let i = 1; i < CHAIN.length; i++) expect(needsOf(CHAIN[i])).toEqual([CHAIN[i - 1]]);
  });

  // The gate is `a == 'x' || b == 'y'`; anything else fails here. GitHub's `==`
  // on these values is a plain string compare.
  const evaluate = (expr, { event, enabled }) => {
    const values = { 'github.event_name': event, 'vars.STOCK_FULL_ENABLED': enabled };
    return expr.split('||').some((clause) => {
      const m = /^\s*([\w.]+)\s*==\s*'([^']*)'\s*$/.exec(clause);
      expect(m, `unexpected clause: ${clause}`).not.toBeNull();
      expect(Object.keys(values)).toContain(m[1]);
      return values[m[1]] === m[2];
    });
  };

  test('the schedule runs only when STOCK_FULL_ENABLED is true; a dispatch always runs', () => {
    const gate = jobs['access-gate'].if;
    expect(typeof gate).toBe('string');
    expect(evaluate(gate, { event: 'schedule', enabled: 'true' })).toBe(true);
    expect(evaluate(gate, { event: 'schedule', enabled: '' })).toBe(false);
    expect(evaluate(gate, { event: 'schedule', enabled: 'false' })).toBe(false);
    expect(evaluate(gate, { event: 'workflow_dispatch', enabled: '' })).toBe(true);
    expect(evaluate(gate, { event: 'workflow_dispatch', enabled: 'false' })).toBe(true);
  });

  test('only check-swap overrides the default success() gate, and never on a skip or cancel', () => {
    for (const job of CHAIN.slice(1, -1)) expect(jobs[job].if, job).toBeUndefined();
    const cond = jobs['check-swap'].if;
    expect(cond).toContain('!cancelled()');
    expect(cond).toContain("needs.build.result == 'success'");
    expect(cond).toContain("needs.build.result == 'failure'");
    expect(cond).not.toContain('always()');
  });
});

// Each case starts a bash; Windows under a full-suite load is slow to spawn one.
describe('access-gate', { timeout: 30_000 }, () => {
  const gateSteps = stepsOf('access-gate');
  const curlStep = gateSteps.find((s) => typeof s.run === 'string' && /\bcurl\b/.test(s.run));

  test('runs curl with no credentials of any kind, on a page and on the public API', () => {
    expect(curlStep).toBeDefined();
    expect(JSON.stringify(jobs['access-gate'])).not.toMatch(/secrets\.|vars\.(?!STOCK_FULL)/);
    expect(curlStep.env).toBeUndefined();
    expect(curlStep.run).not.toMatch(/\s(-H|--header|-u|--user|-b|--cookie|--oauth2-bearer)\b/);
    expect(curlStep.run).toContain("-w '%{http_code} %{redirect_url}'");
    expect(curlStep.run).toContain('"${STG_FULL_URL}${path}"');
    expect(curlStep.run).toContain('for path in / /api/v2/events; do');
    expect(wf.env.STG_FULL_URL).toBe('https://stg-full.oursharedevents.com');
  });

  // The step's own script, with curl replaced by a function that answers per URL.
  function runGate(rootOut, apiOut = rootOut, curlRc = 0) {
    const dir = mkdtempSync(join(tmpdir(), 'stock-gate-'));
    try {
      const argsFile = join(dir, 'args').replace(/\\/g, '/');
      const script = join(dir, 'gate.sh');
      const stub = [
        'curl() {',
        `  printf '%s\\n' "$@" >> '${argsFile}'`,
        '  case "${@: -1}" in',
        `    */api/v2/events) printf '%s' "$FAKE_API" ;;`,
        `    *) printf '%s' "$FAKE_ROOT" ;;`,
        '  esac',
        `  return ${curlRc}`,
        '}',
      ].join('\n');
      writeFileSync(script, `${stub}\n${curlStep.run}`);
      const r = spawnSync(BASH, [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          STG_FULL_URL: wf.env.STG_FULL_URL,
          FAKE_ROOT: rootOut,
          FAKE_API: apiOut,
        },
      });
      const args = existsSync(argsFile) ? readFileSync(argsFile, 'utf8').split('\n') : [];
      return { code: r.status, out: `${r.stdout}${r.stderr}`, args };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test
    .skipIf(!BASH)
    .each([
      '302 https://ourcommunityrituals.cloudflareaccess.com/cdn-cgi/access/login/stg-full?x=1',
      '303 https://team.cloudflareaccess.com/',
      '403 ',
    ])('passes when Access answers both requests: %s', (answer) => {
    const r = runGate(answer);
    expect(r.code, r.out).toBe(0);
    expect(r.args).toContain('https://stg-full.oursharedevents.com/');
    expect(r.args).toContain('https://stg-full.oursharedevents.com/api/v2/events');
  });

  test
    .skipIf(!BASH)
    .each([
      '200 ',
      '302 https://evil.example/login',
      '302 https://cloudflareaccess.com.evil.example/',
      '302 https://x.cloudflareaccess.com@evil.example/',
      '302 http://team.cloudflareaccess.com/',
      '301 https://team.cloudflareaccess.com/',
      '404 ',
      '500 ',
    ])('fails when the Worker or anything else answers: %s', (answer) => {
    const r = runGate(answer);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Real-world data is not loaded onto an open host.');
  });

  test.skipIf(!BASH).each(['200 ', '404 ', '302 https://evil.example/'])(
    'fails when the page is closed but the public API answers: %s',
    (api) => {
      const r = runGate('403 ', api);
      expect(r.code).toBe(1);
      expect(r.out).toContain('/api/v2/events answered HTTP');
      expect(r.out).toContain('Real-world data is not loaded onto an open host.');
    }
  );

  test.skipIf(!BASH)('fails when the request itself fails', () => {
    const r = runGate('', '', 7);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Real-world data is not loaded onto an open host.');
  });
});

describe('secrets', () => {
  test('no job but deploy and check-swap names the Cloudflare token or account', () => {
    for (const job of Object.keys(jobs)) {
      const text = JSON.stringify(jobs[job]);
      const named = /secrets\.CLOUDFLARE_API_TOKEN|secrets\.CLOUDFLARE_ACCOUNT_ID/.test(text);
      expect(named, job).toBe(job === 'deploy' || job === 'check-swap');
    }
    const steps = stepsOf('deploy').concat(stepsOf('check-swap'));
    for (const s of steps) {
      if (!/secrets\.CLOUDFLARE/.test(JSON.stringify(s))) continue;
      expect(JSON.stringify(s.env), s.name).toMatch(/secrets\.CLOUDFLARE_API_TOKEN_OSE/);
    }
  });

  test('secrets reach a step only through env:, and only the action takes one in with:', () => {
    for (const job of Object.keys(jobs)) {
      expect(JSON.stringify(jobs[job].env || {}), job).not.toContain('secrets.');
      for (const s of stepsOf(job)) {
        expect(String(s.run || ''), `${job}/${s.name}`).not.toContain('secrets.');
        const withText = JSON.stringify(s.with || {});
        if (s.uses && s.uses.startsWith('anthropics/claude-code-action@')) {
          expect(withText.match(/secrets\.[A-Z_]+/g)).toEqual(['secrets.ANTHROPIC_API_KEY']);
        } else {
          expect(withText, `${job}/${s.name}`).not.toContain('secrets.');
        }
      }
    }
    expect(JSON.stringify(wf.env)).not.toContain('secrets.');
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

describe('deploy', () => {
  const runs = () =>
    stepsOf('deploy')
      .map((s) => String(s.run || ''))
      .join('\n');

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
    expect(checkouts).toBe(CHAIN.length - 1); // every job but access-gate checks out
  });

  test('deploys to staging-full after migrating both of its databases', () => {
    const text = runs();
    const dbAt = text.indexOf(
      'npx wrangler d1 migrations apply ocr-db-staging-full --env staging-full --remote'
    );
    const formsAt = text.indexOf(
      'npx wrangler d1 migrations apply ocr-forms-db-staging-full --env staging-full --remote'
    );
    const deployAt = text.indexOf('npx wrangler deploy --env staging-full');
    expect(dbAt).toBeGreaterThanOrEqual(0);
    expect(formsAt).toBeGreaterThan(dbAt);
    expect(deployAt).toBeGreaterThan(formsAt);
  });
});

describe('search', () => {
  const steps = stepsOf('search');
  const actionAt = steps.findIndex((s) => /^anthropics\/claude-code-action@/.test(s.uses || ''));
  const action = steps[actionAt];
  const args = action ? String(action.with.claude_args) : '';

  test('the action is pinned to the SHA claude-review.yml uses', () => {
    expect(action.uses).toBe(
      'anthropics/claude-code-action@fa2b2666b747000bf42767d1f332065b375e3c8f'
    );
    const review = readFileSync(join(ROOT, '.github/workflows/claude-review.yml'), 'utf8');
    expect(review).toContain(action.uses);
  });

  test('Sonnet, 80 turns, web search, web fetch and two writes; no shell', () => {
    expect(args).toMatch(/--model claude-sonnet-/);
    expect(args).toMatch(/--max-turns 80\b/);
    const allowed = /--allowedTools "([^"]*)"/.exec(args)[1].split(',');
    expect(allowed).toEqual([
      'WebSearch',
      'WebFetch',
      'Write(stock-out/finds.json)',
      'Write(stock-out/businesses.json)',
    ]);
    const disallowed = /--disallowedTools "([^"]*)"/.exec(args)[1].split(',');
    for (const tool of ['Bash', 'Edit', 'Read', 'Task', 'Agent']) {
      expect(disallowed).toContain(tool);
    }
    expect(args).toContain('--setting-sources user');
  });

  test('the CLI version the cap is checked on names the action SHA it pairs with', () => {
    const text = readFileSync(WF_PATH, 'utf8');
    const at = text.indexOf("CLAUDE_CODE_VERSION: '");
    const comment = text.slice(text.lastIndexOf('# Pairs with', at), at);
    expect(comment).toContain(action.uses.split('@')[1]);
  });

  test('the spend cap is checked fail-closed first, then passed to the CLI', () => {
    const budgetAt = steps.findIndex((s) => s.id === 'budget');
    expect(budgetAt).toBeGreaterThanOrEqual(0);
    expect(budgetAt).toBeLessThan(actionAt);
    const budget = steps[budgetAt];
    expect(budget.env.MAX_USD).toBe("${{ vars.STOCK_SEARCH_MAX_USD || '5' }}");
    expect(budget.run).toContain("grep -q -- '--max-budget-usd'");
    expect(budget.run).toMatch(/exit 1/);
    expect(args).toContain('--max-budget-usd ${{ steps.budget.outputs.usd }}');
  });

  test('the prompt is rendered from the repo before the action runs', () => {
    const promptAt = steps.findIndex((s) => s.id === 'prompt');
    expect(promptAt).toBeGreaterThanOrEqual(0);
    expect(promptAt).toBeLessThan(actionAt);
    expect(steps[promptAt].run).toContain('node scripts/stock/run-day.mjs prepare-search');
    // its files go outside the checkout, so the gate after the search sees only the outputs
    expect(steps[promptAt].env.STOCK_PREP_DIR).toBe('${{ runner.temp }}/stock-prep');
    expect(steps[promptAt].run).not.toMatch(/stock-out\/search-prompt|stock-out\/event-types/);
    expect(action.with.prompt).toBe('${{ steps.prompt.outputs.text }}');
  });

  const gateAt = steps.findIndex((s) => /git status --porcelain/.test(String(s.run || '')));

  test('a gate right after the search, before any repo code, allows only the two outputs', () => {
    expect(gateAt).toBe(actionAt + 1);
    const checkAt = steps.findIndex((s) =>
      String(s.run || '').includes('node scripts/stock/run-day.mjs search-output')
    );
    const uploadAt = steps.findIndex((s) => /^actions\/upload-artifact@/.test(s.uses || ''));
    expect(checkAt).toBeGreaterThan(gateAt);
    expect(uploadAt).toBeGreaterThan(checkAt);
    expect(steps[gateAt].run).toContain('--untracked-files=all');
  });

  // The gate's own script, with git replaced by a function that reports as told.
  function runGitGate(status) {
    const dir = mkdtempSync(join(tmpdir(), 'stock-git-gate-'));
    try {
      const script = join(dir, 'gate.sh');
      writeFileSync(script, `git() { printf '%s' "$FAKE_STATUS"; }\n${steps[gateAt].run}`);
      const r = spawnSync(BASH, [script], {
        encoding: 'utf8',
        env: { ...process.env, FAKE_STATUS: status },
      });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test
    .skipIf(!BASH)
    .each([
      '',
      '?? stock-out/finds.json\n?? stock-out/businesses.json\n',
      '?? stock-out/finds.json\n',
    ])(
    'the gate passes on only the outputs: %j',
    (status) => {
      const r = runGitGate(status);
      expect(r.code, r.out).toBe(0);
    },
    30_000
  );

  test
    .skipIf(!BASH)
    .each([
      '?? stock-out/finds.json\n M scripts/stock/run-day.mjs\n',
      '?? stock-out/finds.json\n?? stock-out/other.json\n',
      '?? .claude/settings.json\n',
      ' D stock/search-prompt.md\n',
      '?? stock-out/finds.json.bak\n',
    ])(
    'the gate fails on anything else: %j',
    (status) => {
      const r = runGitGate(status);
      expect(r.code).toBe(1);
      expect(r.out).toContain('Search changed the checkout');
    },
    30_000
  );

  test('only the two outputs are uploaded', () => {
    const upload = steps.find((s) => /^actions\/upload-artifact@/.test(s.uses || ''));
    expect(upload.with.path.trim().split('\n')).toEqual([
      'stock-out/finds.json',
      'stock-out/businesses.json',
    ]);
  });
});

describe('build and check-swap', () => {
  test('each job runs its run-day subcommand', () => {
    const run = (job) =>
      stepsOf(job)
        .map((s) => String(s.run || ''))
        .join('\n');
    expect(run('validate')).toContain('node scripts/stock/run-day.mjs validate');
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
});

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- reads the repo's own workflow, writes temp scripts, and builds patterns from its env names */
/**
 * The morning stock workflow for the full staging site
 * (.github/workflows/stock-data-full.yml): its triggers, its job chain, its
 * Access gate and where its secrets may appear.
 */
const {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  existsSync,
  rmSync,
} = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
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
  const LOGIN =
    '302 https://ourcommunityrituals.cloudflareaccess.com/cdn-cgi/access/login/stg-full?x=1';
  const NO_LOGIN = 'Access did not answer with its login redirect.';

  test('runs curl with no credentials of any kind, asking for a page, on a page and on the public API', () => {
    expect(curlStep).toBeDefined();
    expect(JSON.stringify(jobs['access-gate'])).not.toMatch(/secrets\.|vars\.(?!STOCK_FULL)/);
    expect(curlStep.env).toBeUndefined();
    // the one header sent is Accept: text/html, so Access answers as it would a browser
    expect(curlStep.run).toContain("-H 'Accept: text/html'");
    const rest = curlStep.run.replace("-H 'Accept: text/html'", '');
    expect(rest).not.toMatch(/\s(-H|--header|-u|--user|-b|--cookie|--oauth2-bearer)\b/);
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
      LOGIN,
      '303 https://team.cloudflareaccess.com/',
      '302 https://Team.CloudflareAccess.com/cdn-cgi/access/login',
    ])(
    'passes when Access answers both / and /api/v2/events with its login redirect: %s',
    (answer) => {
      const r = runGate(answer);
      expect(r.code, r.out).toBe(0);
      expect(r.args).toContain('https://stg-full.oursharedevents.com/');
      expect(r.args).toContain('https://stg-full.oursharedevents.com/api/v2/events');
      expect(r.args).toContain('Accept: text/html');
      expect(r.out).toContain('/: Access redirected to its login host');
      expect(r.out).toContain('/api/v2/events: Access redirected to its login host');
    }
  );

  test
    .skipIf(!BASH)
    .each([
      '403 ',
      '401 ',
      '200 ',
      '302 https://evil.example/login',
      '302 https://cloudflareaccess.com/',
      '302 https://.cloudflareaccess.com/',
      '302 https://cloudflareaccess.com.evil.example/',
      '302 https://x.cloudflareaccess.com@evil.example/',
      '302 http://team.cloudflareaccess.com/',
      '301 https://team.cloudflareaccess.com/',
      '307 https://team.cloudflareaccess.com/',
      '404 ',
      '500 ',
    ])('fails closed on anything but the login redirect: %s', (answer) => {
    const r = runGate(answer);
    expect(r.code).toBe(1);
    expect(r.out).toContain(NO_LOGIN);
    expect(r.out).toContain('Real-world data is not loaded onto an open host.');
  });

  test.skipIf(!BASH)('a plain 403 fails: a deny does not prove Access holds the host', () => {
    const r = runGate('403 ', '403 ');
    expect(r.code).toBe(1);
    expect(r.out).toContain('/ answered HTTP 403');
    expect(r.out).toContain(NO_LOGIN);
  });

  test.skipIf(!BASH).each(['403 ', '200 ', '404 ', '302 https://evil.example/'])(
    'fails when the page redirects to Access but the public API answers: %s',
    (api) => {
      const r = runGate(LOGIN, api);
      expect(r.code).toBe(1);
      expect(r.out).toContain('/api/v2/events answered HTTP');
      expect(r.out).toContain(NO_LOGIN);
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

describe('deploy: the staging-full ids are pasted', { timeout: 30_000 }, () => {
  const steps = stepsOf('deploy');
  const gateAt = steps.findIndex((s) => /OWNER_TO_FILL/.test(String(s.run || '')));
  const gate = steps[gateAt];
  const repoToml = readFileSync(join(ROOT, 'workers/oursharedevents/wrangler.toml'), 'utf8');

  test('runs in the Worker folder before any migration or deploy', () => {
    expect(gate).toBeDefined();
    expect(gate['working-directory']).toBe('${{ env.WORKER_DIR }}');
    const firstWrangler = steps.findIndex((s) => /npx wrangler/.test(String(s.run || '')));
    expect(gateAt).toBeLessThan(firstWrangler);
  });

  // The step's own script, run in a folder holding the given wrangler.toml.
  function runIdGate(toml) {
    const dir = mkdtempSync(join(tmpdir(), 'stock-id-gate-'));
    try {
      writeFileSync(join(dir, 'wrangler.toml'), toml);
      writeFileSync(join(dir, 'gate.sh'), gate.run);
      const r = spawnSync(BASH, ['gate.sh'], { cwd: dir, encoding: 'utf8' });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // A fixture shaped like the repo's block, so these cases hold before and after
  // the owner pastes the real ids into the repo wrangler.toml.
  const UNPROVISIONED = {
    db: 'OWNER_TO_FILL_DB_STAGING_FULL',
    forms: 'OWNER_TO_FILL_FORMS_DB_STAGING_FULL',
    kv: 'OWNER_TO_FILL_KV_STAGING_FULL',
  };
  const PASTED = {
    db: '0f0e0d0c-0000-4000-8000-000000000001',
    forms: '0f0e0d0c-0000-4000-8000-000000000002',
    kv: '0123456789abcdef'.repeat(2),
  };
  const fixture = ({ db, forms, kv }) =>
    [
      'name = "oursharedevents"',
      '[env.staging]',
      'name = "oursharedevents-staging"',
      '# Until the ids are pasted, an OWNER_TO_FILL_* value marks each one.',
      '[env.staging-full]',
      'name = "oursharedevents-stg-full"',
      '[[env.staging-full.d1_databases]]',
      'binding = "DB"',
      '# paste the id over OWNER_TO_FILL_DB_STAGING_FULL',
      `database_id = "${db}"`,
      '[[env.staging-full.d1_databases]]',
      'binding = "FORMS_DB"',
      `database_id = "${forms}"`,
      '[[env.staging-full.kv_namespaces]]',
      'binding = "RATE_LIMIT_KV"',
      `id = "${kv}"`,
      '[env.staging-full.vars]',
      'STAGING_VARIANT = "full"',
      '',
    ].join('\n');

  test.skipIf(!BASH)('fails while the ids are placeholders', () => {
    const r = runIdGate(fixture(UNPROVISIONED));
    expect(r.code).toBe(1);
    expect(r.out).toContain('paste each id over its OWNER_TO_FILL value');
    expect(r.out).toContain('OWNER_TO_FILL_DB_STAGING_FULL');
  });

  test.skipIf(!BASH)(
    'passes once the ids are pasted, comments naming the placeholders aside',
    () => {
      const pasted = fixture(PASTED);
      expect(pasted).toContain('OWNER_TO_FILL'); // still named in comments
      const r = runIdGate(pasted);
      expect(r.code, r.out).toBe(0);
    }
  );

  test.skipIf(!BASH).each(['db', 'forms', 'kv'])('fails on one placeholder left: %s', (left) => {
    const r = runIdGate(fixture({ ...PASTED, [left]: UNPROVISIONED[left] }));
    expect(r.code).toBe(1);
    expect(r.out).toContain(UNPROVISIONED[left]);
  });

  test.skipIf(!BASH)(
    'reads only staging-full: a placeholder in another env is not its concern',
    () => {
      const other = `${fixture(PASTED)}[env.other]\nname = "x"\n[[env.other.kv_namespaces]]\nid = "OWNER_TO_FILL_OTHER"\n`;
      expect(runIdGate(other).code).toBe(0);
    }
  );

  test.skipIf(!BASH)('fails when there is no staging-full block at all', () => {
    const r = runIdGate('name = "x"\n[env.staging]\nname = "y"\n');
    expect(r.code).toBe(1);
    expect(r.out).toContain('no [env.staging-full] block');
  });

  test.skipIf(!BASH)(
    'on the repo wrangler.toml, the verdict matches whether a placeholder remains',
    async () => {
      const { parseToml } = await import(
        pathToFileURL(join(ROOT, 'scripts/prod-preflight.mjs')).href
      );
      const ids = parseToml(repoToml)
        .filter((s) => /^env\.staging-full\.(d1_databases|kv_namespaces)$/.test(s.header))
        .map((s) => s.values.database_id ?? s.values.id);
      expect(ids).toHaveLength(3);
      const left = ids.some((id) => id.startsWith('OWNER_TO_FILL_'));
      expect(runIdGate(repoToml).code).toBe(left ? 1 : 0);
    }
  );
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
    expect(steps[gateAt].run).toContain('--ignored');
  });

  test('stock-out/ is git-ignored, so its files never get committed by accident', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('stock-out/');
  });

  // The gate's own script against a real git: a throwaway repo with this repo's
  // .gitignore, so ignored paths are judged as they would be in the checkout.
  function runRealGitGate(files) {
    const repo = mkdtempSync(join(tmpdir(), 'stock-real-gate-'));
    const scripts = mkdtempSync(join(tmpdir(), 'stock-real-gate-sh-'));
    const git = (...a) =>
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
        cwd: repo,
        encoding: 'utf8',
      });
    try {
      writeFileSync(join(repo, '.gitignore'), readFileSync(join(ROOT, '.gitignore'), 'utf8'));
      git('init', '-q');
      git('add', '.gitignore');
      git('commit', '-qm', 'base');
      for (const f of files) {
        mkdirSync(dirname(join(repo, f)), { recursive: true });
        writeFileSync(join(repo, f), '[]');
      }
      const script = join(scripts, 'gate.sh');
      writeFileSync(script, steps[gateAt].run);
      const r = spawnSync(BASH, [script], { cwd: repo, encoding: 'utf8' });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(scripts, { recursive: true, force: true });
    }
  }

  test.skipIf(!BASH)(
    'with a real git: the two ignored outputs pass, a planted ignored file fails',
    () => {
      const ok = runRealGitGate(['stock-out/finds.json', 'stock-out/businesses.json']);
      expect(ok.code, ok.out).toBe(0);
      const planted = runRealGitGate(['stock-out/finds.json', 'node_modules/ajv/dist/ajv.js']);
      expect(planted.code).toBe(1);
      expect(planted.out).toContain('!! node_modules/ajv/dist/ajv.js');
      const env = runRealGitGate(['stock-out/finds.json', '.env']);
      expect(env.code).toBe(1);
    },
    30_000
  );

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
      '!! stock-out/finds.json\n!! stock-out/businesses.json\n',
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
      '!! stock-out/finds.json\n!! node_modules/ajv/dist/ajv.js\n',
      '!! stock-out/other.json\n',
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

describe('the search installs nothing into the checkout before its gate', () => {
  const steps = stepsOf('search');
  const actionAt = steps.findIndex((s) => /^anthropics\/claude-code-action@/.test(s.uses || ''));
  const gateAt = steps.findIndex((s) => /git status --porcelain/.test(String(s.run || '')));
  const installs = (s) => /\bnpm\s+(ci|install|i)\b|\byarn\b|\bpnpm\b/.test(String(s.run || ''));

  test('every install before the gate happens in a copy outside the checkout', () => {
    expect(gateAt).toBe(actionAt + 1);
    const early = steps.slice(0, gateAt).filter(installs);
    expect(early).toHaveLength(1);
    expect(early[0].env.PREP_SRC).toBe('${{ runner.temp }}/stock-src');
    expect(early[0].run).toContain('git archive HEAD | tar -x -C "$PREP_SRC"');
    const cdAt = early[0].run.indexOf('cd "$PREP_SRC"');
    expect(cdAt).toBeGreaterThanOrEqual(0);
    expect(cdAt).toBeLessThan(early[0].run.indexOf('npm ci'));
    expect(early[0]['working-directory']).toBeUndefined();
  });

  test('repo code before the gate runs from that copy', () => {
    for (const s of steps.slice(0, gateAt)) {
      if (!/\bnode\s+scripts\//.test(String(s.run || ''))) continue;
      expect(s['working-directory'], s.name).toBe('${{ runner.temp }}/stock-src');
    }
  });

  test('the checkout gets its dependencies after the gate, then the schema check runs', () => {
    const installAt = steps.findIndex((s, i) => i > gateAt && installs(s));
    const checkAt = steps.findIndex((s) => /run-day\.mjs search-output/.test(String(s.run || '')));
    expect(installAt).toBeGreaterThan(gateAt);
    expect(steps[installAt]['working-directory']).toBeUndefined();
    expect(checkAt).toBeGreaterThan(installAt);
  });
});

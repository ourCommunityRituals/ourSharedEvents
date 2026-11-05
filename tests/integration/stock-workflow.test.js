/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- reads the repo's own workflow, writes temp scripts, and builds patterns from its env names */
/**
 * The stock workflow for the full staging site
 * (.github/workflows/stock-data-full.yml): its trigger (manual only), its job
 * chain, its Access gate and where its secrets may appear. Owner, 2026-11-05:
 * no nightly search; the site loads from the committed seed.
 */
const { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const WF_PATH = join(ROOT, '.github', 'workflows', 'stock-data-full.yml');
const wf = yaml.load(readFileSync(WF_PATH, 'utf8'));
const jobs = wf.jobs || {};
const CHAIN = ['access-gate', 'deploy', 'seed', 'build', 'check-swap'];
const needsOf = (job) => {
  const n = jobs[job] && jobs[job].needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
};
const stepsOf = (job) => (jobs[job] && jobs[job].steps) || [];
// The workflow's own bash steps run under a real bash with stubbed commands.
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const BASH = process.platform === 'win32' ? (existsSync(GIT_BASH) ? GIT_BASH : null) : 'bash';

// The gate scripts below run under bash. Missing bash is a red test, never a skip:
// a gate that silently skips counts as absent.
test('bash is available to run the workflow gate scripts', () => {
  expect(BASH, `bash not found (looked for ${GIT_BASH} on Windows)`).not.toBeNull();
});

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
  test('access-gate → deploy → seed → build → check-swap', () => {
    expect(Object.keys(jobs)).toEqual(CHAIN);
    expect(needsOf('access-gate')).toEqual([]);
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

// Each case starts a bash; Windows under a full-suite load is slow to spawn one.
describe('access-gate', { timeout: 30_000 }, () => {
  const gateSteps = stepsOf('access-gate');
  const curlStep = gateSteps.find((s) => typeof s.run === 'string' && /\bcurl\b/.test(s.run));
  const LOGIN =
    '302 https://ourcommunityrituals.cloudflareaccess.com/cdn-cgi/access/login/stg-full?x=1';
  const NO_LOGIN = 'Access did not answer with its login redirect.';

  test('runs curl with no credentials of any kind, asking for a page, on a page and on the public API', () => {
    expect(curlStep).toBeDefined();
    expect(JSON.stringify(jobs['access-gate'])).not.toMatch(/secrets\.|vars\./);
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

  test.each([
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

  test.each([
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

  test('a plain 403 fails: a deny does not prove Access holds the host', () => {
    const r = runGate('403 ', '403 ');
    expect(r.code).toBe(1);
    expect(r.out).toContain('/ answered HTTP 403');
    expect(r.out).toContain(NO_LOGIN);
  });

  test.each(['403 ', '200 ', '404 ', '302 https://evil.example/'])(
    'fails when the page redirects to Access but the public API answers: %s',
    (api) => {
      const r = runGate(LOGIN, api);
      expect(r.code).toBe(1);
      expect(r.out).toContain('/api/v2/events answered HTTP');
      expect(r.out).toContain(NO_LOGIN);
    }
  );

  test('fails when the request itself fails', () => {
    const r = runGate('', '', 7);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Real-world data is not loaded onto an open host.');
  });
});

describe('secrets', () => {
  test('no job but deploy, build and check-swap names the Cloudflare token or account', () => {
    const CLOUDFLARE_JOBS = ['deploy', 'build', 'check-swap'];
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

  test('fails while the ids are placeholders', () => {
    const r = runIdGate(fixture(UNPROVISIONED));
    expect(r.code).toBe(1);
    expect(r.out).toContain('paste each id over its OWNER_TO_FILL value');
    expect(r.out).toContain('OWNER_TO_FILL_DB_STAGING_FULL');
  });

  test('passes once the ids are pasted, comments naming the placeholders aside', () => {
    const pasted = fixture(PASTED);
    expect(pasted).toContain('OWNER_TO_FILL'); // still named in comments
    const r = runIdGate(pasted);
    expect(r.code, r.out).toBe(0);
  });

  test.each(['db', 'forms', 'kv'])('fails on one placeholder left: %s', (left) => {
    const r = runIdGate(fixture({ ...PASTED, [left]: UNPROVISIONED[left] }));
    expect(r.code).toBe(1);
    expect(r.out).toContain(UNPROVISIONED[left]);
  });

  test('reads only staging-full: a placeholder in another env is not its concern', () => {
    const other = `${fixture(PASTED)}[env.other]\nname = "x"\n[[env.other.kv_namespaces]]\nid = "OWNER_TO_FILL_OTHER"\n`;
    expect(runIdGate(other).code).toBe(0);
  });

  test('fails when there is no staging-full block at all', () => {
    const r = runIdGate('name = "x"\n[env.staging]\nname = "y"\n');
    expect(r.code).toBe(1);
    expect(r.out).toContain('no [env.staging-full] block');
  });

  test('on the repo wrangler.toml, the verdict matches whether a placeholder remains', async () => {
    const { parseToml } = await import(
      pathToFileURL(join(ROOT, 'scripts/prod-preflight.mjs')).href
    );
    const ids = parseToml(repoToml)
      .filter((s) => /^env\.staging-full\.(d1_databases|kv_namespaces)$/.test(s.header))
      .map((s) => s.values.database_id ?? s.values.id);
    expect(ids).toHaveLength(3);
    const left = ids.some((id) => id.startsWith('OWNER_TO_FILL_'));
    expect(runIdGate(repoToml).code).toBe(left ? 1 : 0);
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

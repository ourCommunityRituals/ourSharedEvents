/**
 * The weekly client test site, test.oursharedevents.com (OSE-2211).
 *
 * Holds the site's config to a staging-class Worker with no CI escape hatch,
 * the weekly workflow to green staging commits on main and to its own config
 * file, the setup workflow to never showing or replacing a secret, and the
 * check after each deploy to failing when the site is public. Each rule has a
 * case that feeds it the fault it must catch.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own files, by paths written in this file
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (t) =>
  t
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const TEST_TOML = 'workers/oursharedevents/wrangler.client-test.toml';
const MAIN_TOML = 'workers/oursharedevents/wrangler.toml';
const SITE_WF = '.github/workflows/client-test-site.yml';
const SETUP_WF = '.github/workflows/client-test-setup.yml';
const SMOKE = 'scripts/ci/client-test-smoke.sh';

let lib;
let parseToml;
beforeAll(async () => {
  lib = await import('../../../scripts/ci/client-test-site.mjs');
  ({ parseToml } = await import('../../../scripts/prod-preflight.mjs'));
});

/** Top-level keys and [vars] of a single-environment wrangler file. */
function configOf(text) {
  const sections = parseToml(text);
  const top = sections.find((s) => s.header === '' || s.header === undefined)?.values ?? {};
  const vars = sections.find((s) => s.header === 'vars')?.values ?? {};
  return { sections, top, vars };
}

/** What is wrong with a client test site config, as sentences. Pure. */
function configProblems(testText, mainText) {
  const out = [];
  const t = configOf(testText);
  const m = parseToml(mainText);
  const stgVars = m.find((s) => s.header === 'env.staging.vars')?.values ?? {};
  if (t.vars.WORKER_ENV !== 'staging') {
    out.push(`WORKER_ENV is "${t.vars.WORKER_ENV}"; the test site must run as "staging"`);
  }
  for (const hatch of [
    'ADMIN_SCOPE_ALL',
    'ALLOW_ADMIN_KEY_FALLBACK',
    'ALLOW_OCR_INTERNAL',
    'CI_SERVICE_ACTORS',
    'CI_SERVICE_ACTOR_BRAND',
    'STAGING_TESTERS',
  ]) {
    if (hatch in t.vars) {
      out.push(`${hatch} is set; the test site carries no CI escape hatch`);
    }
  }
  if (/\[env\./.test(stripComments(testText))) {
    out.push('the file declares a named environment');
  }
  if (!/^name = "oursharedevents-test"$/m.test(testText)) {
    out.push('the Worker is not oursharedevents-test');
  }
  if (!/pattern = "test\.oursharedevents\.com\/\*"/.test(testText)) {
    out.push('the route is not the test host');
  }
  if (/workers_dev = true/.test(testText) || !/^workers_dev = false$/m.test(testText)) {
    out.push('workers_dev is not false (a public workers.dev address would skip Access)');
  }
  // Settings shared with wrangler.toml.
  for (const key of ['main', 'compatibility_date', 'account_id']) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- the key is one of three constants
    const re = new RegExp(`^${key} = "([^"]*)"`, 'm');
    const a = re.exec(testText)?.[1];
    const b = re.exec(mainText)?.[1];
    if (a !== b) {
      out.push(`${key} is "${a}" here and "${b}" in wrangler.toml`);
    }
  }
  // Its own data: no database, namespace or uploads bucket of staging or production.
  const theirs = /^(?:database_name|bucket_name|id) = "([^"]+)"/gm;
  const mainNames = new Set([...mainText.matchAll(theirs)].map((x) => x[1]));
  for (const [, name] of testText.matchAll(theirs)) {
    if (name === 'ose-map-tiles' || name === lib.PLACEHOLDER) {
      continue;
    }
    if (mainNames.has(name)) {
      out.push(`"${name}" is also used in wrangler.toml`);
    }
  }
  for (const name of [...lib.RESOURCES.d1, ...lib.RESOURCES.r2]) {
    if (!testText.includes(`"${name}"`)) {
      out.push(`the setup creates ${name}, the config does not use it`);
    }
  }
  // Limiter counts never shared.
  const ids = (txt) => [...txt.matchAll(/^namespace_id = "(\d+)"/gm)].map((x) => x[1]);
  for (const id of ids(testText)) {
    if (ids(mainText).includes(id)) {
      out.push(`limiter namespace ${id} is shared with wrangler.toml`);
    }
  }
  // The street map: staging's one bucket, staging's archive key and switch.
  if (!/binding = "MAP_TILES"\r?\nbucket_name = "ose-map-tiles"/.test(testText)) {
    out.push('MAP_TILES does not read the one archive bucket ose-map-tiles');
  }
  for (const key of ['MAP_TILES_ARCHIVE', 'STREET_MAP', 'VOTING_ENABLED']) {
    if (t.vars[key] !== stgVars[key]) {
      out.push(`${key} is "${t.vars[key]}" here and "${stgVars[key]}" on staging`);
    }
  }
  return out;
}

describe('the client test site config', () => {
  const testText = () => read(TEST_TOML);
  const mainText = () => read(MAIN_TOML);

  test('the real file has no problem', () => {
    expect(configProblems(testText(), mainText())).toEqual([]);
  });

  test.each([
    [
      'a local WORKER_ENV',
      'WORKER_ENV = "staging"',
      'WORKER_ENV = "test"',
      'must run as "staging"',
    ],
    [
      'WORKER_ENV production',
      'WORKER_ENV = "staging"',
      'WORKER_ENV = "production"',
      'must run as "staging"',
    ],
    [
      'a key fallback',
      'TURNSTILE_ENABLED = "0"',
      'TURNSTILE_ENABLED = "0"\nALLOW_ADMIN_KEY_FALLBACK = "true"',
      'ALLOW_ADMIN_KEY_FALLBACK',
    ],
    [
      'scope-all',
      'TURNSTILE_ENABLED = "0"',
      'TURNSTILE_ENABLED = "0"\nADMIN_SCOPE_ALL = "true"',
      'ADMIN_SCOPE_ALL',
    ],
    [
      'testers in a var',
      'TURNSTILE_ENABLED = "0"',
      'TURNSTILE_ENABLED = "0"\nSTAGING_TESTERS = "{}"',
      'STAGING_TESTERS',
    ],
    [
      "staging's database",
      'database_name = "ocr-db-test"',
      'database_name = "ocr-db-staging"',
      'ocr-db-staging',
    ],
    [
      "staging's uploads bucket",
      'bucket_name = "ose-uploads-test"',
      'bucket_name = "ose-uploads-staging"',
      'ose-uploads-staging',
    ],
    [
      'a shared limiter id',
      'namespace_id = "15097"',
      'namespace_id = "15093"',
      'limiter namespace 15093',
    ],
    [
      'another tile bucket',
      'bucket_name = "ose-map-tiles"',
      'bucket_name = "ose-map-tiles-dev"',
      'MAP_TILES does not read',
    ],
    [
      'an old archive key',
      'MAP_TILES_ARCHIVE = "us-20261120.pmtiles"',
      'MAP_TILES_ARCHIVE = "us-20261115.pmtiles"',
      'MAP_TILES_ARCHIVE is',
    ],
    ['workers.dev on', 'workers_dev = false', 'workers_dev = true', 'workers_dev'],
    [
      'the staging host',
      'test.oursharedevents.com/*',
      'stg.oursharedevents.com/*',
      'the route is not the test host',
    ],
    [
      'another compatibility date',
      'compatibility_date = "2026-04-28"',
      'compatibility_date = "2026-01-01"',
      'compatibility_date',
    ],
    [
      'a named environment',
      '[vars]',
      '[env.production]\nname = "x"\n\n[vars]',
      'named environment',
    ],
  ])('refused: %s', (_label, from, to, expected) => {
    const text = testText();
    expect(text).toContain(from);
    const problems = configProblems(text.replace(from, to), mainText());
    expect(problems.join('\n')).toContain(expected);
  });

  test('wrangler.toml itself is untouched: still exactly staging and production', () => {
    const envs = new Set([...mainText().matchAll(/^\[env\.([a-z]+)\]/gm)].map((x) => x[1]));
    expect([...envs].sort()).toEqual(['production', 'staging']);
  });
});

describe('resolveIds', () => {
  const toml = [
    '[[d1_databases]]',
    'binding = "DB"',
    'database_name = "ocr-db-test"',
    'database_id = "set-by-setup"',
    '',
    '[[d1_databases]]',
    'binding = "FORMS_DB"',
    'database_name = "ocr-forms-db-test"',
    'database_id = "set-by-setup"',
    '',
    '[[kv_namespaces]]',
    'binding = "RATE_LIMIT_KV"',
    'id = "set-by-setup"',
  ].join('\n');
  const d1 = [
    { name: 'ocr-db-staging', uuid: 'stg-uuid' },
    { name: 'ocr-db-test', uuid: 'aaaa' },
    { name: 'ocr-forms-db-test', uuid: 'bbbb' },
  ];
  const kv = [
    { title: 'rate-limit-staging', id: 'stg-kv' },
    { title: 'ose-rate-limit-test', id: 'cccc' },
  ];

  test('fills every id by exact name, and nothing of staging', () => {
    const { text, missing } = lib.resolveIds(toml, d1, kv);
    expect(missing).toEqual([]);
    expect(text).toContain('database_id = "aaaa"');
    expect(text).toContain('database_id = "bbbb"');
    expect(text).toContain('id = "cccc"');
    expect(text).not.toContain('set-by-setup');
    expect(text).not.toContain('stg-');
  });

  test('a missing database is reported, never guessed', () => {
    const { missing } = lib.resolveIds(
      toml,
      d1.filter((d) => d.name !== 'ocr-forms-db-test'),
      kv
    );
    expect(missing).toEqual(['D1 database ocr-forms-db-test']);
  });

  test('a missing namespace is reported', () => {
    const { missing } = lib.resolveIds(toml, d1, kv.slice(0, 1));
    expect(missing).toEqual(['KV namespace ose-rate-limit-test']);
  });

  test('the real file resolves with the names the setup creates', () => {
    const real = read(TEST_TOML);
    const { missing } = lib.resolveIds(
      real,
      lib.RESOURCES.d1.map((name, i) => ({ name, uuid: `u${i}` })),
      lib.RESOURCES.kv.map((title, i) => ({ title, id: `k${i}` }))
    );
    expect(missing).toEqual([]);
  });
});

describe('pickGreenSha', () => {
  const ok = (name) => ({ name, conclusion: 'success' });
  const all = () => lib.STAGING_CHAIN_JOBS.map(ok);
  const runs = [
    { id: 3, head_sha: 'ccc' },
    { id: 2, head_sha: 'bbb' },
    { id: 1, head_sha: 'aaa' },
  ];

  test('the newest run with all four staging jobs green', async () => {
    const jobs = { 3: all(), 2: all(), 1: all() };
    expect(await lib.pickGreenSha(runs, async (id) => jobs[id])).toEqual({ sha: 'ccc', runId: 3 });
  });

  const CHAIN = [
    'T1 Deploy → Staging',
    'T2 Contract → Staging (Bruno)',
    'T3 E2E Smoke → Staging (Playwright)',
    'T4 Functional → Staging',
  ];

  test('the four staging jobs of the Definition of Done', () => {
    expect(lib.STAGING_CHAIN_JOBS).toEqual(CHAIN);
  });

  test.each(CHAIN.map((n) => [n]))('skips a run where "%s" failed', async (bad) => {
    const jobs = {
      3: all().map((j) => (j.name === bad ? { ...j, conclusion: 'failure' } : j)),
      2: all(),
      1: all(),
    };
    expect((await lib.pickGreenSha(runs, async (id) => jobs[id])).sha).toBe('bbb');
  });

  test('skips a run where a staging job was skipped or is missing', async () => {
    const jobs = {
      3: all().map((j, i) => (i === 3 ? { ...j, conclusion: 'skipped' } : j)),
      2: all().slice(0, 3),
      1: all(),
    };
    expect((await lib.pickGreenSha(runs, async (id) => jobs[id])).sha).toBe('aaa');
  });

  test('nothing green: nothing to deploy', async () => {
    expect(await lib.pickGreenSha(runs, async () => [])).toBeNull();
  });

  test('a commit the caller rules out is passed over', async () => {
    const picked = await lib.pickGreenSha(
      runs,
      async () => all(),
      (sha) => sha !== 'ccc'
    );
    expect(picked.sha).toBe('bbb');
  });

  test("the job names are the CI workflow's own", () => {
    const ci = read('.github/workflows/oursharedevents-ci.yml');
    for (const name of lib.STAGING_CHAIN_JOBS) {
      expect(ci).toContain(`name: '${name}'`);
    }
  });
});

describe('the weekly workflow', () => {
  const text = () => read(SITE_WF);
  const wf = () => yaml.load(text());

  test('runs Mondays 11:00 UTC and by hand, never on push or pull request', () => {
    const on = wf().on;
    expect(on.schedule).toEqual([{ cron: '0 11 * * 1' }]);
    expect(on.workflow_dispatch.inputs.action.options).toEqual(['update', 'rollback', 'look']);
    expect(on.push).toBeUndefined();
    expect(on.pull_request).toBeUndefined();
  });

  test('a scheduled run obeys the hold switch', () => {
    expect(text()).toMatch(/HOLD: \$\{\{ vars\.CLIENT_TEST_HOLD \}\}/);
    expect(text()).toMatch(/"\$EVENT" = "schedule" \] && \[ "\$HOLD" = "true" \]/);
  });

  test('every wrangler call names the test config, and never staging or production', () => {
    const code = stripComments(text());
    const calls = [
      ...code.matchAll(
        // eslint-disable-next-line security/detect-unsafe-regex -- reads this repository's workflow
        /wrangler(?:@[\d.]+)? (deploy|rollback|d1 migrations apply|secret list|deployments list)[^\n]*/g
      ),
    ];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const [line] of calls) {
      expect(line).toContain('-c "$TEST_CONFIG"');
    }
    expect(code).not.toMatch(/--env\b|-e (staging|production)/);
    expect(code).toMatch(/TEST_CONFIG: wrangler\.client-test\.toml/);
  });

  test('an update deploys only the picked commit, after the on-main gate', () => {
    const steps = wf().jobs.update.steps;
    expect(steps[0].with.ref).toBe('${{ needs.pick.outputs.sha }}');
    const names = steps.map((s) => s.name ?? s.uses);
    const at = (needle) => names.findIndex((n) => String(n).includes(needle));
    expect(at('on main')).toBeGreaterThan(0);
    expect(at('on main')).toBeLessThan(at('Deploy the client test site'));
    expect(at('Find the test site databases')).toBeLessThan(at('Apply new migrations'));
    expect(at('secrets exist')).toBeLessThan(at('Apply new migrations'));
    expect(at('Apply new migrations')).toBeLessThan(at('Deploy the client test site'));
    expect(at('Deploy the client test site')).toBeLessThan(at('private, and up'));
  });

  test('update and rollback both end with the privacy check', () => {
    for (const job of ['update', 'rollback']) {
      const last = wf().jobs[job].steps.at(-1);
      expect(last.run).toContain('bash scripts/ci/client-test-smoke.sh');
    }
  });

  test('never resets data: no d1 execute, no delete', () => {
    const code = stripComments(text());
    expect(code).not.toMatch(
      /d1 execute|d1 delete|DROP TABLE|DELETE FROM|r2 object delete|kv key delete/i
    );
  });
});

describe('the setup workflow', () => {
  const text = () => read(SETUP_WF);
  const code = () => stripComments(text());

  test('is dispatch-only and wants TEST typed', () => {
    const on = yaml.load(text()).on;
    expect(Object.keys(on)).toEqual(['workflow_dispatch']);
    expect(code()).toMatch(/"\$CONFIRM" != "TEST"/);
  });

  test('creates exactly the names the config and the resolver use', () => {
    for (const name of [...lib.RESOURCES.d1, ...lib.RESOURCES.kv, ...lib.RESOURCES.r2]) {
      expect(code()).toContain(name);
    }
    expect(code()).not.toMatch(
      /staging"|production"|ocr-db-staging|ocr-db-production|ose-map-tiles/
    );
  });

  test('masks every value it makes, keeps it in an owner-only file, and never prints it', () => {
    const c = code();
    expect(c).toMatch(/VALUE="\$\(openssl rand -hex 32\)"\n\s+echo "::add-mask::\$VALUE"/);
    expect(c).toContain('umask 077');
    expect(c).toMatch(/trap 'rm -f "\$FILE"' EXIT/);
    expect(c).not.toMatch(/echo "\$VALUE"|cat "\$FILE"|set -x/);
    expect(c).not.toMatch(/secret put/);
  });

  test('never replaces a secret that exists', () => {
    expect(code()).toMatch(
      /grep -q "\\"\$SECRET\\""[^\n]*\n[^\n]*already set, left as it is[^\n]*\n\s+continue/
    );
  });

  test('sets the six secrets the weekly gate checks for', () => {
    const want = code()
      .match(/for SECRET in ([A-Z_ ]+); do/)[1]
      .trim()
      .split(/\s+/)
      .sort();
    const gate = stripComments(read(SITE_WF))
      .match(/for SECRET in ([A-Z_ ]+); do/)[1]
      .trim()
      .split(/\s+/)
      .sort();
    expect(want).toEqual(gate);
    expect(want).toHaveLength(6);
  });

  test('never deploys', () => {
    // eslint-disable-next-line security/detect-unsafe-regex -- reads this repository's workflow
    expect(code()).not.toMatch(/wrangler(@[\d.]+)? deploy|wrangler rollback/);
  });
});

describe('the check after each deploy', () => {
  const text = () => read(SMOKE);

  test('fails when an anonymous visit is answered with the site', () => {
    const t = text();
    expect(t).toMatch(/302 \| 401 \| 403\)/);
    expect(t).toMatch(
      /200\)\n\s+echo "::error title=The client test site is public::[^\n]*"\n\s+exit 1/
    );
  });

  test('checks health as the staging-class Worker, and three pages', () => {
    const t = text();
    expect(t).toMatch(/"\$ENV_NAME" != "staging"/);
    expect(t).toMatch(/for path in \/ \/map \/events; do/);
  });
});

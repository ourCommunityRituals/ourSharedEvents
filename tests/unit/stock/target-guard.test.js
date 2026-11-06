/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own stock files */
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const path = require('node:path');

/**
 * The stock run touches the staging site only (owner 2026-11-06: one staging
 * site, stg., carries the seed). Every command and URL in its scripts, its
 * workflow and its seed names `staging` / `stg.`, never production and never a
 * second staging site.
 */

const ROOT = path.join(__dirname, '../../..');

const RULES = [
  { name: '--env production', re: /--env(?:\s+|=)["']?production/ },
  { name: "'--env', 'production'", re: /['"`]--env['"`]\s*,\s*['"`]production['"`]/ },
  { name: '-e production', re: /(?:^|\s)-e(?:\s+|=)production/m },
  { name: '//oursharedevents.com', re: /\/\/oursharedevents\.com/ },
  { name: 'a second staging site', re: /stg-full|stg-empty|staging-full/ },
  { name: 'wrangler deploy', re: /wrangler\s+deploy/ },
];

const offences = (text) => RULES.filter((r) => r.re.test(text)).map((r) => r.name);

const FILES = [
  ...readdirSync(path.join(ROOT, 'scripts/stock')).map((f) => `scripts/stock/${f}`),
  '.github/workflows/stock-data-full.yml',
  'stock/seed/seed.json',
];

// Comment lines may explain what is gone (the workflow header names stg-full to
// say there is none); only code counts.
const code = (text) =>
  text
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l))
    .join('\n');

describe('detector controls', () => {
  test.each([
    ['npx wrangler d1 execute x --env production --remote', '--env production'],
    ['wrangler d1 execute x --env=production --remote', '--env production'],
    ['npx wrangler d1 execute x --env "production"', '--env production'],
    ["spawn(['d1', '--env', 'production'])", "'--env', 'production'"],
    ['wrangler r2 object get x -e production', '-e production'],
    ['curl -sS $PROTO//oursharedevents.com/api', '//oursharedevents.com'],
    ['https://stg-full.oursharedevents.com/', 'a second staging site'],
    ['wrangler d1 execute x --env staging-full --remote', 'a second staging site'],
    ['npx wrangler deploy --env staging', 'wrangler deploy'],
  ])('flags %j', (text, rule) => {
    expect(offences(text)).toContain(rule);
  });

  test.each([
    'wrangler d1 execute ocr-db-staging --env staging --remote',
    "['--env', 'staging', '--remote']",
    'https://stg.oursharedevents.com/',
    'ose-uploads-staging/stock/manifest-index.json',
  ])('passes %j', (text) => {
    expect(offences(text)).toEqual([]);
  });

  test('comment lines are not code', () => {
    expect(code('# there is no separate stg-full site\nrun: x')).toBe('run: x');
  });
});

describe('the stock run names only the staging site', () => {
  test('it scans the scripts, the workflow and the seed', () => {
    for (const rel of FILES) expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
    expect(FILES).toContain('scripts/stock/run-day.mjs');
  });

  test.each(FILES)('%s names no other env or host', (rel) => {
    expect(offences(code(readFileSync(path.join(ROOT, rel), 'utf8')))).toEqual([]);
  });

  test('the run script and the client do name staging', () => {
    const run = readFileSync(path.join(ROOT, 'scripts/stock/run-day.mjs'), 'utf8');
    expect(run).toContain("WRANGLER_ENV = 'staging'");
    expect(run).toContain("D1_DATABASE = 'ocr-db-staging'");
    expect(run).toContain("R2_BUCKET = 'ose-uploads-staging'");
    const client = readFileSync(path.join(ROOT, 'scripts/stock/client.mjs'), 'utf8');
    expect(client).toContain("STOCK_BASE_URL = 'https://stg.oursharedevents.com'");
  });
});

// Every wrangler command goes through run-day's one runner, which refuses any
// command not aimed at --env staging (assertStaging). The workflow runs none itself.
const WRANGLER_LINE = /\bwrangler\s+(?:d1|deploy|r2|kv|secret|versions|rollback|tail|queues)\b/;
function unscopedRunCalls(text) {
  const bad = [];
  for (const m of text.matchAll(/await run\(([^;]*?)\]\);/gs)) {
    if (!m[1].includes('...remote')) bad.push(m[0].replace(/\s+/g, ' '));
  }
  return bad;
}

describe('every wrangler invocation goes through the guarded runner', () => {
  test('detector controls', () => {
    expect(
      unscopedRunCalls("await run('x', ['d1', 'execute', D1, ...remote, '--file', p]);")
    ).toEqual([]);
    expect(unscopedRunCalls("await run('x', ['d1', 'execute', D1, '--file', p]);")).toHaveLength(1);
  });

  const wf = readFileSync(path.join(ROOT, '.github/workflows/stock-data-full.yml'), 'utf8');
  const run = readFileSync(path.join(ROOT, 'scripts/stock/run-day.mjs'), 'utf8');

  test('the workflow runs no wrangler command of its own', () => {
    expect(
      code(wf)
        .split('\n')
        .filter((l) => WRANGLER_LINE.test(l))
    ).toEqual([]);
  });

  test('in run-day.mjs', () => {
    expect(run).toContain("const remote = ['--env', WRANGLER_ENV, '--remote'];");
    expect([...run.matchAll(/await run\(/g)].length).toBeGreaterThanOrEqual(4);
    expect(unscopedRunCalls(run)).toEqual([]);
    // the runner is the only place the wrangler binary is named
    expect([...run.matchAll(/'wrangler'/g)]).toHaveLength(1);
  });
});

/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own stock files */
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const path = require('node:path');

/**
 * The stock run touches the full staging site only. Every command and URL in
 * its scripts, its workflow and its seed names `staging-full` /
 * `stg-full.`, never the empty staging site or production.
 */

const ROOT = path.join(__dirname, '../../..');

const RULES = [
  { name: '--env staging', re: /--env(?:\s+|=)["']?staging(?!-full)/ },
  { name: "'--env', 'staging'", re: /['"`]--env['"`]\s*,\s*['"`]staging(?!-full)['"`]/ },
  { name: '-e staging', re: /(?:^|\s)-e(?:\s+|=)staging(?!-full)/m },
  { name: '--env production', re: /--env(?:\s+|=)["']?production/ },
  { name: "'--env', 'production'", re: /['"`]--env['"`]\s*,\s*['"`]production['"`]/ },
  { name: 'stg.oursharedevents.com', re: /stg\.oursharedevents\.com/ },
  { name: '//oursharedevents.com', re: /\/\/oursharedevents\.com/ },
];

const offences = (text) => RULES.filter((r) => r.re.test(text)).map((r) => r.name);

const FILES = [
  ...readdirSync(path.join(ROOT, 'scripts/stock')).map((f) => `scripts/stock/${f}`),
  '.github/workflows/stock-data-full.yml',
  'stock/seed/seed.json',
];

describe('detector controls', () => {
  test.each([
    ['npx wrangler deploy --env staging', '--env staging'],
    ['npx wrangler deploy --env staging\n', '--env staging'],
    ['wrangler d1 execute x --env=staging --remote', '--env staging'],
    ['npx wrangler deploy --env "staging"', '--env staging'],
    ["npx wrangler deploy --env 'staging' --remote", '--env staging'],
    ['npx wrangler deploy --env "production"', '--env production'],
    ["spawn(['d1', '--env', 'staging'])", "'--env', 'staging'"],
    ['wrangler r2 object get x -e staging', '-e staging'],
    ['npx wrangler deploy --env production', '--env production'],
    ["['--env', 'production']", "'--env', 'production'"],
    ['curl https://stg.oursharedevents.com/health', 'stg.oursharedevents.com'],
    ['curl -sS $PROTO//oursharedevents.com/api', '//oursharedevents.com'],
  ])('flags %j', (text, rule) => {
    expect(offences(text)).toContain(rule);
  });

  test.each([
    'npx wrangler deploy --env staging-full',
    'npx wrangler deploy --env "staging-full"',
    'wrangler d1 execute ocr-db-staging-full --env=staging-full --remote',
    "['--env', 'staging-full']",
    'https://stg-full.oursharedevents.com/',
    'ose-uploads-staging-full/stock/manifest-index.json',
  ])('passes %j', (text) => {
    expect(offences(text)).toEqual([]);
  });
});

describe('the stock run names only the full staging site', () => {
  test('it scans the scripts, the workflow and the seed', () => {
    for (const rel of FILES) expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
    expect(FILES).toContain('scripts/stock/run-day.mjs');
  });

  test.each(FILES)('%s names no other env or host', (rel) => {
    expect(offences(readFileSync(path.join(ROOT, rel), 'utf8'))).toEqual([]);
  });

  test('the workflow and the run script do name the full site', () => {
    const wf = readFileSync(path.join(ROOT, '.github/workflows/stock-data-full.yml'), 'utf8');
    expect(wf).toContain('--env staging-full');
    expect(wf).toContain('stg-full.oursharedevents.com');
    const run = readFileSync(path.join(ROOT, 'scripts/stock/run-day.mjs'), 'utf8');
    expect(run).toContain("WRANGLER_ENV = 'staging-full'");
  });
});

// Every wrangler command line names the full env: in the workflow, each line that
// runs a wrangler subcommand; in run-day.mjs, each command array it hands the runner.
const WRANGLER_LINE = /\bwrangler\s+(?:d1|deploy|r2|kv|secret|versions|rollback|tail|queues)\b/;
const unscopedWorkflowLines = (text) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line) && WRANGLER_LINE.test(line))
    .filter((line) => !line.includes('--env staging-full'));
function unscopedRunCalls(text) {
  const bad = [];
  for (const m of text.matchAll(/await run\(([^;]*?)\]\);/gs)) {
    if (!m[1].includes('...remote')) bad.push(m[0].replace(/\s+/g, ' '));
  }
  return bad;
}

describe('every wrangler invocation names --env staging-full', () => {
  test('detector controls', () => {
    expect(unscopedWorkflowLines('run: npx wrangler deploy --env staging-full\n')).toEqual([]);
    expect(unscopedWorkflowLines('run: npx wrangler deploy\n# npx wrangler deploy\n')).toEqual([
      'run: npx wrangler deploy',
    ]);
    expect(
      unscopedRunCalls("await run('x', ['d1', 'execute', D1, ...remote, '--file', p]);")
    ).toEqual([]);
    expect(unscopedRunCalls("await run('x', ['d1', 'execute', D1, '--file', p]);")).toHaveLength(1);
  });

  const wf = readFileSync(path.join(ROOT, '.github/workflows/stock-data-full.yml'), 'utf8');
  const run = readFileSync(path.join(ROOT, 'scripts/stock/run-day.mjs'), 'utf8');

  test('in the workflow', () => {
    expect(wf.split('\n').filter((l) => WRANGLER_LINE.test(l)).length).toBeGreaterThan(3);
    expect(unscopedWorkflowLines(wf)).toEqual([]);
  });

  test('in run-day.mjs', () => {
    expect(run).toContain("const remote = ['--env', WRANGLER_ENV, '--remote'];");
    expect([...run.matchAll(/await run\(/g)].length).toBeGreaterThanOrEqual(4);
    expect(unscopedRunCalls(run)).toEqual([]);
    // the runner is the only place the wrangler binary is named
    expect([...run.matchAll(/'wrangler'/g)]).toHaveLength(1);
  });
});

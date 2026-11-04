/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own stock files */
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const path = require('node:path');

/**
 * The stock run touches the full staging site only. Every command and URL in
 * its scripts, its workflow and its search prompt names `staging-full` /
 * `stg-full.`, never the empty staging site or production.
 */

const ROOT = path.join(__dirname, '../../..');

const RULES = [
  { name: '--env staging', re: /--env(?:\s+|=)staging(?!-full)/ },
  { name: "'--env', 'staging'", re: /['"`]--env['"`]\s*,\s*['"`]staging(?!-full)['"`]/ },
  { name: '-e staging', re: /(?:^|\s)-e(?:\s+|=)staging(?!-full)/m },
  { name: '--env production', re: /--env(?:\s+|=)production/ },
  { name: "'--env', 'production'", re: /['"`]--env['"`]\s*,\s*['"`]production['"`]/ },
  { name: 'stg.oursharedevents.com', re: /stg\.oursharedevents\.com/ },
  { name: '//oursharedevents.com', re: /\/\/oursharedevents\.com/ },
];

const offences = (text) => RULES.filter((r) => r.re.test(text)).map((r) => r.name);

const FILES = [
  ...readdirSync(path.join(ROOT, 'scripts/stock')).map((f) => `scripts/stock/${f}`),
  '.github/workflows/stock-data-full.yml',
  'stock/search-prompt.md',
];

describe('detector controls', () => {
  test.each([
    ['npx wrangler deploy --env staging', '--env staging'],
    ['npx wrangler deploy --env staging\n', '--env staging'],
    ['wrangler d1 execute x --env=staging --remote', '--env staging'],
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
    'wrangler d1 execute ocr-db-staging-full --env=staging-full --remote',
    "['--env', 'staging-full']",
    'https://stg-full.oursharedevents.com/',
    'ose-uploads-staging-full/stock/manifest-index.json',
  ])('passes %j', (text) => {
    expect(offences(text)).toEqual([]);
  });
});

describe('the stock run names only the full staging site', () => {
  test('it scans the scripts, the workflow and the search prompt', () => {
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

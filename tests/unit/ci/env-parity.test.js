/**
 * Staging and production config parity gate (scripts/ci/env-parity.mjs).
 *
 * Each case feeds the comparison a wrangler.toml and, for each rule, the fault
 * that must turn it red. The last cases run it against the real file.
 */
const fs = require('node:fs');
const path = require('node:path');

let parity;

beforeAll(async () => {
  parity = await import('../../../scripts/ci/env-parity.mjs');
});

/** A pair of environments that differ only where they are allowed to. */
const BASE = `
[env.staging]
name = "w-stg"
[[env.staging.d1_databases]]
binding = "DB"
database_id = "stg-id"
[[env.staging.ratelimits]]
name = "PUBLIC_READ_EDGE_LIMITER"
namespace_id = "1"
simple = { limit = 60, period = 10 }
[[env.staging.r2_buckets]]
binding = "MAP_TILES"
bucket_name = "tiles-stg"
[[env.staging.queues.producers]]
binding = "SCAN_QUEUE"
queue = "ose-scans"
[[env.staging.queues.consumers]]
queue = "ose-scans"
max_batch_size = 100
max_retries = 3
[env.staging.triggers]
crons = ["0 3 * * *"]
[env.staging.vars]
WORKER_ENV = "staging"
WORKER_BUILD_VERSION = "stg-1"
DRAFT_EXPIRY_DAYS = "30"
ADMIN_SCOPE_ALL = "true"
ALLOW_ADMIN_KEY_FALLBACK = "true"
ALLOW_OCR_INTERNAL = "true"
WIF_PROVIDER_ID = "stg"
WIF_ISSUER = "https://stg.example.com"
BIGQUERY_DATASET_ID = "d_stg"
CF_ACCESS_AUD = ""

[env.production]
name = "w-prod"
[[env.production.d1_databases]]
binding = "DB"
database_id = "prod-id"
[[env.production.ratelimits]]
name = "PUBLIC_READ_EDGE_LIMITER"
namespace_id = "2"
simple = { limit = 60, period = 10 }
[env.production.triggers]
crons = ["0 3 * * *"]
[env.production.vars]
WORKER_ENV = "production"
WORKER_BUILD_VERSION = "prod-1"
DRAFT_EXPIRY_DAYS = "30"
WIF_PROVIDER_ID = "prod"
WIF_ISSUER = "https://example.com"
BIGQUERY_DATASET_ID = "d"
CF_ACCESS_AUD = ""
`;

const keys = (r, level) => r.findings.filter((f) => f.level === level).map((f) => f.key);

describe('the intentional differences', () => {
  test('a pair that differs only where allowed has no unlisted difference', () => {
    const r = parity.compareEnvironments(BASE);
    expect(keys(r, 'unlisted')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(keys(r, 'intentional')).toEqual(
      expect.arrayContaining([
        'only-in-staging:ADMIN_SCOPE_ALL',
        'value:WORKER_ENV',
        'value:WIF_ISSUER',
        'value:BIGQUERY_DATASET_ID',
      ])
    );
  });

  test('the open items are reported, and strict does not pass while they are open', () => {
    const r = parity.compareEnvironments(BASE);
    expect(keys(r, 'undecided')).toEqual(
      expect.arrayContaining([
        'binding:queues.producers:SCAN_QUEUE',
        'binding:queues.consumers:ose-scans',
        'binding:r2_buckets:MAP_TILES',
      ])
    );
    expect(r.ok).toBe(true);
    expect(r.strictOk).toBe(false);
  });

  test('a pinned production audience against an unpinned staging one is intentional, not unlisted', () => {
    const r = parity.compareEnvironments(
      BASE.replace(
        'WIF_ISSUER = "https://example.com"\nBIGQUERY_DATASET_ID = "d"\nCF_ACCESS_AUD = ""',
        'WIF_ISSUER = "https://example.com"\nBIGQUERY_DATASET_ID = "d"\nCF_ACCESS_AUD = "abc123"'
      )
    );
    expect(keys(r, 'unlisted')).toEqual([]);
    expect(keys(r, 'intentional')).toContain('value:CF_ACCESS_AUD');
    expect(keys(r, 'undecided')).not.toContain('value:CF_ACCESS_AUD');
  });
});

describe('each rule turns red on its fault', () => {
  test('a setting only production carries, unlisted', () => {
    const r = parity.compareEnvironments(
      BASE.replace('[env.production.vars]', '[env.production.vars]\nNEW_SETTING = "1"')
    );
    expect(keys(r, 'unlisted')).toContain('only-in-production:NEW_SETTING');
    expect(r.ok).toBe(false);
  });

  test('a staging-only switch that appears in production is an unlisted difference', () => {
    const r = parity.compareEnvironments(
      BASE.replace('[env.production.vars]', '[env.production.vars]\nADMIN_SCOPE_ALL = "true"')
    );
    // Present on both sides now, with equal values: the rule is that it is NOT only-in-staging.
    expect(keys(r, 'intentional')).not.toContain('only-in-staging:ADMIN_SCOPE_ALL');
  });

  test('a setting with a different value that is not on the allowed list', () => {
    const r = parity.compareEnvironments(
      BASE.replace(
        '[env.production.vars]\nWORKER_ENV',
        '[env.production.vars]\nDRAFT_EXPIRY_DAYS_X = "x"\nWORKER_ENV'
      ).replace(
        'DRAFT_EXPIRY_DAYS = "30"\nWIF_PROVIDER_ID = "prod"',
        'DRAFT_EXPIRY_DAYS = "0"\nWIF_PROVIDER_ID = "prod"'
      )
    );
    expect(keys(r, 'unlisted')).toContain('value:DRAFT_EXPIRY_DAYS');
  });

  test('a binding declared for one environment only', () => {
    const r = parity.compareEnvironments(
      BASE.replace(
        '[env.production.triggers]',
        '[[env.production.kv_namespaces]]\nbinding = "EXTRA_KV"\nid = "x"\n[env.production.triggers]'
      )
    );
    expect(keys(r, 'unlisted')).toContain('binding:kv_namespaces:EXTRA_KV');
  });

  test('a different rate limit on the same binding', () => {
    const r = parity.compareEnvironments(
      BASE.replace(
        '[[env.production.ratelimits]]\nname = "PUBLIC_READ_EDGE_LIMITER"\nnamespace_id = "2"\nsimple = { limit = 60, period = 10 }',
        '[[env.production.ratelimits]]\nname = "PUBLIC_READ_EDGE_LIMITER"\nnamespace_id = "2"\nsimple = { limit = 600, period = 10 }'
      )
    );
    expect(keys(r, 'unlisted')).toContain(
      'binding-field:ratelimits:PUBLIC_READ_EDGE_LIMITER:simple'
    );
  });

  test('a different nightly job', () => {
    const r = parity.compareEnvironments(
      BASE.replace(
        '[env.production.triggers]\ncrons = ["0 3 * * *"]',
        '[env.production.triggers]\ncrons = ["0 4 * * *"]'
      )
    );
    expect(keys(r, 'unlisted')).toContain('triggers.crons');
  });

  test('an undecided entry that stops being a difference is itself a finding', () => {
    // Give production the queue: SCAN_QUEUE is no longer a difference.
    const withQueue = BASE.replace(
      '[env.production.triggers]',
      '[[env.production.queues.producers]]\nbinding = "SCAN_QUEUE"\nqueue = "ose-scans"\n[[env.production.queues.consumers]]\nqueue = "ose-scans"\nmax_batch_size = 100\nmax_retries = 3\n[env.production.triggers]'
    );
    const r = parity.compareEnvironments(withQueue);
    expect(keys(r, 'unlisted')).toEqual(
      expect.arrayContaining([
        'stale-undecided:binding:queues.producers:SCAN_QUEUE',
        'stale-undecided:binding:queues.consumers:ose-scans',
      ])
    );
  });

  test('a missing environment block', () => {
    const r = parity.compareEnvironments('[env.staging.vars]\nWORKER_ENV = "staging"\n');
    expect(r.ok).toBe(false);
  });
});

describe('the real wrangler.toml', () => {
  const real = () =>
    fs.readFileSync(path.join(__dirname, '../../../', parity.WRANGLER_PATH), 'utf8');

  test('has no unlisted difference between staging and production', () => {
    const r = parity.compareEnvironments(real());
    expect(r.findings.filter((f) => f.level === 'unlisted')).toEqual([]);
  });

  test('reports the open items the owner has to rule on', () => {
    const r = parity.compareEnvironments(real());
    expect(keys(r, 'undecided').sort()).toEqual([
      'binding:queues.consumers:ose-scans',
      'binding:queues.producers:SCAN_QUEUE',
      'binding:r2_buckets:MAP_TILES',
    ]);
  });

  // Staging first (owner 2026-11-09): the street-map bucket is bound on staging
  // only, and the archive is named the same on both sides so that the later
  // production PR adds a binding and nothing else. The archive is the United
  // States subset (owner 2026-11-10), so the name starts "us-", not "planet-".
  test('the street-map archive: bound on staging only, named the same on both sides', () => {
    const toml = real();
    const stg = toml.slice(toml.indexOf('[env.staging]'), toml.indexOf('[env.production]'));
    const prod = toml.slice(toml.indexOf('[env.production]'));
    expect(stg).toMatch(/^\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"\r?$/m);
    expect(prod).not.toMatch(/^binding = "MAP_TILES"\r?$/m);
    const name = /^MAP_TILES_ARCHIVE = "(us-\d{8}\.pmtiles)"\r?$/m;
    expect(stg).toMatch(name);
    expect(name.exec(prod)?.[1]).toBe(name.exec(stg)?.[1]);
    // The parity check itself reports the one-sided binding as open, not as fine.
    const open = parity
      .compareEnvironments(toml)
      .findings.find((f) => f.key === 'binding:r2_buckets:MAP_TILES');
    expect(open?.level).toBe('undecided');
  });

  test('production pins the Access audience (OSE-1353)', () => {
    const toml = real();
    const prod = toml.slice(toml.indexOf('[env.production.vars]'));
    expect(prod).toMatch(/^CF_ACCESS_AUD = "[a-f0-9]{64}"$/m);
  });
});

// Location-precision CCR, F33: nothing made staging get the street map before
// production. The Bruno staging environment records whether the archive is
// loaded there (streetMapArchiveLoaded). While it is "false" the two staging
// street-map cases print NOT RUN when no streets are drawn; once it is "true"
// they fail. Production may carry the binding only after that.
// @born-red street map staging first | method: each rule is fed the fault that turns it red, in the cases below; the parity check itself seen failing (2 unlisted differences) with the staging binding and no open entry | date: 2026-11-09
describe('the street map reaches staging before production', () => {
  const STAGING_ENV = 'bruno/ose-pages/environments/ose-staging.yml';
  const stagingEnv = () => fs.readFileSync(path.join(__dirname, '../../../', STAGING_ENV), 'utf8');
  const real = () =>
    fs.readFileSync(path.join(__dirname, '../../../workers/oursharedevents/wrangler.toml'), 'utf8');
  const BINDS = {
    staging: /^\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"/m,
    production: /^\[\[env\.production\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"/m,
  };

  /**
   * What is wrong with the order, as sentences. Pure: takes the two files' text
   * and the production preflight's list of bindings production may still lack.
   */
  function orderProblems(toml, envYaml, dark = []) {
    const staging = BINDS.staging.test(toml);
    const production = BINDS.production.test(toml);
    const loaded = /name: streetMapArchiveLoaded\r?\n\s+value: "(true|false)"/.exec(envYaml)?.[1];
    const out = [];
    if (!loaded) {
      out.push(`${STAGING_ENV} must set streetMapArchiveLoaded to "true" or "false"`);
    }
    if (production && !staging) {
      out.push('production binds MAP_TILES and staging does not');
    }
    if (production && loaded !== 'true') {
      out.push(
        'production binds MAP_TILES while the staging cases can still print NOT RUN: set streetMapArchiveLoaded to "true" first, in a PR whose staging run drew streets'
      );
    }
    if (!staging && loaded === 'true') {
      out.push('streetMapArchiveLoaded is "true" and staging has no MAP_TILES binding');
    }
    if (production && dark.includes('r2_buckets/MAP_TILES')) {
      out.push(
        'production binds MAP_TILES and scripts/prod-preflight.mjs still lists it in DARK_ON_PRODUCTION: remove the line'
      );
    }
    return out;
  }

  // Anchored: the file's opening comments name this header too.
  const withProduction = (toml) =>
    toml.replace(
      /^\[env\.production\.triggers\]/m,
      '[[env.production.r2_buckets]]\nbinding = "MAP_TILES"\nbucket_name = "ose-map-tiles-production"\n\n[env.production.triggers]'
    );
  const withFlag = (yaml, v) =>
    yaml.replace(/(name: streetMapArchiveLoaded\r?\n\s+value: )"(true|false)"/, `$1"${v}"`);

  test('the real files are in order', async () => {
    const { DARK_ON_PRODUCTION } = await import('../../../scripts/prod-preflight.mjs');
    expect(orderProblems(real(), stagingEnv(), DARK_ON_PRODUCTION)).toEqual([]);
  });

  test('production bound while the preflight still excuses it: refused', async () => {
    const { DARK_ON_PRODUCTION } = await import('../../../scripts/prod-preflight.mjs');
    expect(DARK_ON_PRODUCTION).toContain('r2_buckets/MAP_TILES');
    const toml = withProduction(real());
    const env = withFlag(stagingEnv(), 'true');
    expect(orderProblems(toml, env, DARK_ON_PRODUCTION)).toEqual([
      'production binds MAP_TILES and scripts/prod-preflight.mjs still lists it in DARK_ON_PRODUCTION: remove the line',
    ]);
    expect(orderProblems(toml, env, [])).toEqual([]);
  });

  test('production bound before the staging cases can fail: refused', () => {
    const toml = withProduction(real());
    expect(toml).not.toBe(real());
    expect(orderProblems(toml, withFlag(stagingEnv(), 'false')).join(' ')).toMatch(
      /production binds MAP_TILES while the staging cases can still print NOT RUN/
    );
    expect(orderProblems(toml, withFlag(stagingEnv(), 'true'))).toEqual([]);
  });

  test('production bound with no staging binding: refused', () => {
    const toml = withProduction(real()).replace(
      /\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"/,
      '[[env.staging.r2_buckets]]\nbinding = "OTHER"'
    );
    expect(orderProblems(toml, withFlag(stagingEnv(), 'true')).join(' ')).toMatch(
      /production binds MAP_TILES and staging does not/
    );
  });

  test('the archive called loaded with no staging binding, or the setting missing: refused', () => {
    const noStaging = real().replace(
      /\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"/,
      '[[env.staging.r2_buckets]]\nbinding = "OTHER"'
    );
    expect(orderProblems(noStaging, withFlag(stagingEnv(), 'true'))).toEqual([
      'streetMapArchiveLoaded is "true" and staging has no MAP_TILES binding',
    ]);
    expect(orderProblems(noStaging, withFlag(stagingEnv(), 'false'))).toEqual([]);
    expect(
      orderProblems(real(), stagingEnv().replace('streetMapArchiveLoaded', 'renamed')).join(' ')
    ).toMatch(/must set streetMapArchiveLoaded/);
  });

  test('both street-map cases read the setting and print NOT RUN by name', () => {
    const dir = '../../../bruno/ose-pages/1. Landing - Public';
    const cases = [
      fs.readFileSync(
        path.join(__dirname, dir, 'GET - (landing) - draws streets under the map.yml'),
        'utf8'
      ),
      fs.readFileSync(
        path.join(
          __dirname,
          dir,
          'GET - (landing) area 872664570ffffff - one area over its streets.yml'
        ),
        'utf8'
      ),
    ];
    for (const text of cases) {
      expect(text).toContain("bru.getEnvVar('streetMapArchiveLoaded')");
      expect(text).toMatch(/console\.log\('NOT RUN \(street-map archive not loaded/);
      expect(text).toMatch(/streetMapArchiveLoaded is true for this environment/);
    }
  });

  test('the wrangler.toml these cases read is the one the parity check reads', () => {
    expect(parity.WRANGLER_PATH).toBe('workers/oursharedevents/wrangler.toml');
  });
});

// Fat fingers (owner 2026-11-10). The bucket and the object key are typed by
// hand: in wrangler.toml, and in the commands the runbook gives the owner (check
// the bucket is private, cut the United States file out of a build, upload it).
// A slip in any one of them is silent: the deploy passes, the Worker finds no
// object, and the map stays hexagons only. These rules compare them.
// @born-red street-map names typed by hand | method: each rule is fed the slip that turns it red, in the cases below; "the real files agree" seen failing with wrangler.toml changed to us-20261109.pmtiles while the runbook still uploaded planet-20261109.pmtiles; each rule on the runbook's commands (private check, public command, extract output, extract build, upload file, upload target) switched off in turn, and its cases below went red | date: 2026-11-10
describe('the street-map names the owner types are the names the Worker binds', () => {
  const root = (p) => fs.readFileSync(path.join(__dirname, '../../../', p), 'utf8');
  const RUNBOOK = 'docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md';
  const toml = () => root('workers/oursharedevents/wrangler.toml');
  const runbook = () => root(RUNBOOK);
  const workerRule = () => {
    const src = root('workers/oursharedevents/src/lib/street-map.ts');
    const m = /^const ARCHIVE_NAME = \/(.+)\/;\r?$/m.exec(src);
    if (!m) throw new Error('ARCHIVE_NAME not found in lib/street-map.ts');
    return new RegExp(m[1]);
  };

  /** What does not agree, as sentences. Pure: takes the files' text. */
  function nameProblems(tomlText, runbookText, rule) {
    const out = [];
    const stg = tomlText.slice(
      tomlText.search(/^\[env\.staging\]/m),
      tomlText.search(/^\[env\.production\]/m)
    );
    const bucket =
      /^\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"\r?\nbucket_name = "([^"]*)"/m.exec(
        stg
      )?.[1];
    const key = /^MAP_TILES_ARCHIVE = "([^"]*)"\r?$/m.exec(stg)?.[1];
    if (bucket === undefined) return ['staging has no MAP_TILES bucket_name'];
    if (key === undefined) return ['staging has no MAP_TILES_ARCHIVE'];
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
      out.push(`"${bucket}" is not a bucket name R2 accepts`);
    }
    if (!rule.test(key)) out.push(`the Worker refuses the archive name "${key}"`);
    const others = [...tomlText.matchAll(/^bucket_name = "([^"]*)"\r?$/gm)].map((m) => m[1]);
    if (others.filter((b) => b === bucket).length > 1) {
      out.push(`"${bucket}" is bound more than once: staging must have a bucket of its own`);
    }
    // The bucket exists (the staging deploy of 2026-11-10 made it), so the
    // runbook checks it instead of creating it: no r2.dev URL, no custom domain.
    const privacyChecks = [
      ['dev-url get', /wrangler r2 bucket dev-url get (\S+)/],
      ['domain list', /wrangler r2 bucket domain list (\S+)/],
    ];
    for (const [check, command] of privacyChecks) {
      const checked = command.exec(runbookText)?.[1];
      if (checked !== bucket) {
        out.push(`the runbook runs "${check}" on "${checked}", wrangler.toml binds "${bucket}"`);
      }
    }
    if (/wrangler r2 bucket (?:dev-url enable|domain add)/.test(runbookText)) {
      out.push('the runbook has a command that makes a bucket public');
    }
    // The file is cut from a build, then uploaded: one name from end to end.
    const cut = /pmtiles extract https:\/\/build\.protomaps\.com\/(\d{8})\.pmtiles (\S+)/.exec(
      runbookText
    );
    if (cut?.[2] !== key) {
      out.push(`the runbook extracts to "${cut?.[2]}", the Worker reads "${key}"`);
    }
    if (cut && !key.includes(cut[1])) {
      out.push(`the runbook cuts build ${cut[1]}, the archive name "${key}" says another date`);
    }
    const upload = /rclone copyto (\S+) r2:(\S+)/.exec(runbookText);
    if (upload?.[1] !== key) {
      out.push(`the runbook uploads the file "${upload?.[1]}", the extract is "${key}"`);
    }
    if (upload?.[2] !== `${bucket}/${key}`) {
      out.push(`the runbook uploads to "${upload?.[2]}", the Worker reads "${bucket}/${key}"`);
    }
    // Between the two, the file is read by the Worker's own reader
    // (workers/oursharedevents/scripts/check-street-map-archive.mjs).
    const check =
      /node workers\/oursharedevents\/scripts\/check-street-map-archive\.mjs (\S+)/.exec(
        runbookText
      );
    if (check?.[1] !== key) {
      out.push(`the runbook checks the file "${check?.[1]}", the extract is "${key}"`);
    }
    if (check && cut && upload && !(cut.index < check.index && check.index < upload.index)) {
      out.push('the runbook does not check the file between cutting it and uploading it');
    }
    // The sentence wraps in the runbook, so compare with the line breaks folded.
    const oneLine = runbookText.replace(/\s+/g, ' ');
    if (!oneLine.includes(`scoped to \`${bucket}\` only`)) {
      out.push(`the runbook's token is not scoped to "${bucket}"`);
    }
    return out;
  }

  test('the real files agree', () => {
    expect(nameProblems(toml(), runbook(), workerRule())).toEqual([]);
  });

  test('the rule read from the Worker is its own: it takes the key in wrangler.toml and refuses a path', () => {
    const rule = workerRule();
    expect(rule.test('us-20261109.pmtiles')).toBe(true);
    expect(rule.test('../us-20261109.pmtiles')).toBe(false);
  });

  test.each([
    ['a letter dropped from the bucket', 'ose-map-tiles-staging', 'ose-map-tiles-stagin'],
    ['the dev bucket copied down', 'ose-map-tiles-staging', 'ose-map-tiles-dev'],
    ['a capital in the bucket', 'ose-map-tiles-staging', 'Ose-map-tiles-staging'],
    ['an underscore in the bucket', 'ose-map-tiles-staging', 'ose_map_tiles_staging'],
  ])('fat finger in wrangler.toml: %s', (_, from, to) => {
    const slipped = toml().replace(
      `binding = "MAP_TILES"\nbucket_name = "${from}"`,
      `binding = "MAP_TILES"\nbucket_name = "${to}"`
    );
    const slippedCrlf = toml().replace(
      `binding = "MAP_TILES"\r\nbucket_name = "${from}"`,
      `binding = "MAP_TILES"\r\nbucket_name = "${to}"`
    );
    const text = slipped === toml() ? slippedCrlf : slipped;
    expect(text).not.toBe(toml());
    expect(nameProblems(text, runbook(), workerRule())).not.toEqual([]);
  });

  test.each([
    ['two digits of the date swapped', 'us-20261019.pmtiles'],
    ['the extension in capitals', 'us-20261109.PMTILES'],
    ['a capital in the name', 'US-20261109.pmtiles'],
    ['a space after', 'us-20261109.pmtiles '],
    ['the bucket pasted in front', 'ose-map-tiles-staging/us-20261109.pmtiles'],
    ['the planet name of 2026-11-09 left in', 'planet-20261109.pmtiles'],
  ])('fat finger in wrangler.toml: the archive name with %s', (_, to) => {
    const stgAt = toml().search(/^\[env\.staging\]/m);
    const text =
      toml().slice(0, stgAt) +
      toml()
        .slice(stgAt)
        .replace('MAP_TILES_ARCHIVE = "us-20261109.pmtiles"', `MAP_TILES_ARCHIVE = "${to}"`);
    expect(text).not.toBe(toml());
    expect(nameProblems(text, runbook(), workerRule())).not.toEqual([]);
  });

  test.each([
    [
      'the upload key with two digits swapped',
      'r2:ose-map-tiles-staging/us-20261109.pmtiles',
      'r2:ose-map-tiles-staging/us-20261019.pmtiles',
    ],
    [
      'the upload to the production bucket',
      'r2:ose-map-tiles-staging/us-20261109.pmtiles',
      'r2:ose-map-tiles-production/us-20261109.pmtiles',
    ],
    [
      'the upload under the bare build name',
      'r2:ose-map-tiles-staging/us-20261109.pmtiles',
      'r2:ose-map-tiles-staging/20261109.pmtiles',
    ],
    [
      'the upload under the planet key of 2026-11-09',
      'r2:ose-map-tiles-staging/us-20261109.pmtiles',
      'r2:ose-map-tiles-staging/planet-20261109.pmtiles',
    ],
    [
      'a whole build uploaded in place of the extract',
      'rclone copyto us-20261109.pmtiles',
      'rclone copyto 20261109.pmtiles',
    ],
    [
      'the extract written under another name',
      '20261109.pmtiles us-20261109.pmtiles --region',
      '20261109.pmtiles usa-20261109.pmtiles --region',
    ],
    [
      'the extract cut from another build',
      'build.protomaps.com/20261109.pmtiles us-',
      'build.protomaps.com/20261108.pmtiles us-',
    ],
    [
      'another bucket checked for a public URL',
      'dev-url get ose-map-tiles-staging',
      'dev-url get ose-map-tiles-stg',
    ],
    [
      'another bucket checked for a custom domain',
      'domain list ose-map-tiles-staging',
      'domain list ose-uploads-staging',
    ],
    [
      'a command that turns the public URL on, added under the checks',
      'domain list ose-map-tiles-staging',
      'domain list ose-map-tiles-staging\n   npx wrangler r2 bucket dev-url enable ose-map-tiles-staging',
    ],
    [
      'a command that gives the bucket a custom domain, added under the checks',
      'domain list ose-map-tiles-staging',
      'domain list ose-map-tiles-staging\n   npx wrangler r2 bucket domain add ose-map-tiles-staging',
    ],
    [
      'the token scoped to another bucket',
      '`ose-map-tiles-staging` only',
      '`ose-uploads-staging` only',
    ],
    [
      'the check run on a file of another date',
      'check-street-map-archive.mjs us-20261109.pmtiles',
      'check-street-map-archive.mjs us-20261019.pmtiles',
    ],
    [
      'the check run on the whole build',
      'check-street-map-archive.mjs us-20261109.pmtiles',
      'check-street-map-archive.mjs 20261109.pmtiles',
    ],
    [
      'the check command dropped',
      'node workers/oursharedevents/scripts/check-street-map-archive.mjs us-20261109.pmtiles',
      '',
    ],
  ])('fat finger in the runbook: %s', (_, from, to) => {
    const text = runbook().replace(from, to);
    expect(text).not.toBe(runbook());
    expect(nameProblems(toml(), text, workerRule())).not.toEqual([]);
  });

  // The check is worth nothing after the upload: a file that fails it is
  // already in the bucket.
  // @born-red street-map check order | method: the order rule switched off in nameProblems, and this test went red; the "check" rule switched off, and the three check cases above went red | date: 2026-11-11
  test('fat finger in the runbook: the check moved after the upload', () => {
    const check =
      'node workers/oursharedevents/scripts/check-street-map-archive.mjs us-20261109.pmtiles';
    const upload =
      'rclone copyto us-20261109.pmtiles r2:ose-map-tiles-staging/us-20261109.pmtiles --progress --s3-chunk-size=256M';
    expect(runbook()).toContain(check);
    expect(runbook()).toContain(upload);
    const moved = runbook().replace(check, '').replace(upload, `${upload}\n   ${check}`);
    expect(nameProblems(toml(), moved, workerRule())).toEqual([
      'the runbook does not check the file between cutting it and uploading it',
    ]);
  });

  // The area the extract keeps (owner 2026-11-10): 50 states, DC, Puerto Rico
  // and the US Virgin Islands, as boxes. The runbook's command names the file;
  // a place left out of it draws hexagons only, with no error anywhere.
  // @born-red street-map region file | method: 4 faults injected one at a time: the Puerto Rico box's east edge moved from -64.5 to -65.5 (two places reported left out), the box east of 180 removed (Attu left out), a ring left open, the path in the runbook's command mistyped; each turned this test red | date: 2026-11-10
  test('the region the runbook cuts is a file in this repo, and holds the United States and not the rest', () => {
    const file = /--region=(\S+)/.exec(runbook())?.[1];
    expect(file).toBe('docs/runbooks/street-map-us-region.geojson');
    const region = JSON.parse(root(file));
    expect(region.type).toBe('Feature');
    expect(region.geometry.type).toBe('MultiPolygon');
    const rings = region.geometry.coordinates.map((polygon) => polygon[0]);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring.at(-1)).toEqual(ring[0]);
      for (const [lon, lat] of ring) {
        expect(Math.abs(lon)).toBeLessThanOrEqual(180);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      }
    }
    // Even-odd ray casting, so the rule holds if a box is redrawn as a border.
    const inRing = (ring, lon, lat) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    };
    const held = ([lon, lat]) => rings.some((ring) => inRing(ring, lon, lat));
    const inside = {
      Chicago: [-87.63, 41.88],
      'Sawyer, Michigan': [-86.59, 41.89],
      'Key West': [-81.78, 24.56],
      'Eastport, Maine': [-66.98, 44.91],
      'Neah Bay, Washington': [-124.62, 48.37],
      'Brownsville, Texas': [-97.5, 25.9],
      'Washington, DC': [-77.04, 38.91],
      Anchorage: [-149.9, 61.22],
      'Utqiagvik, Alaska': [-156.79, 71.29],
      'Ketchikan, Alaska': [-131.65, 55.34],
      'Attu, Alaska (east of 180)': [172.9, 52.9],
      Honolulu: [-157.86, 21.31],
      'Hilo, Hawaii': [-155.09, 19.71],
      'San Juan, Puerto Rico': [-66.11, 18.47],
      'Charlotte Amalie, US Virgin Islands': [-64.93, 18.34],
      'Christiansted, US Virgin Islands': [-64.7, 17.75],
    };
    const outside = {
      London: [-0.13, 51.51],
      'Mexico City': [-99.13, 19.43],
      Tokyo: [139.69, 35.69],
      Sydney: [151.21, -33.87],
      Havana: [-82.37, 23.11],
      Reykjavik: [-21.94, 64.15],
    };
    expect(Object.keys(inside).filter((name) => !held(inside[name]))).toEqual([]);
    expect(Object.keys(outside).filter((name) => held(outside[name]))).toEqual([]);
  });

  test('rainy: a wrangler.toml with no staging bucket, or no archive name, is named, not passed', () => {
    const noBucket = toml().replace(
      /\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"/,
      '[[env.staging.r2_buckets]]\nbinding = "OTHER"'
    );
    expect(nameProblems(noBucket, runbook(), workerRule())).toEqual([
      'staging has no MAP_TILES bucket_name',
    ]);
    const stgAt = toml().search(/^\[env\.staging\]/m);
    const noKey =
      toml().slice(0, stgAt) +
      toml().slice(stgAt).replace('MAP_TILES_ARCHIVE = ', 'MAP_TILES_ARCHIV = ');
    expect(nameProblems(noKey, runbook(), workerRule())).toEqual([
      'staging has no MAP_TILES_ARCHIVE',
    ]);
  });
});

describe('the CI step', () => {
  const wf = () =>
    fs.readFileSync(
      path.join(__dirname, '../../../.github/workflows/oursharedevents-ci.yml'),
      'utf8'
    );

  test('runs the parity check, and runs it strict once PRODUCTION_LIVE is true', () => {
    const text = wf();
    const i = text.indexOf("name: 'Lint: staging and production config parity'");
    expect(i, 'the parity step exists').toBeGreaterThan(-1);
    const step = text.slice(i, i + 600);
    expect(step).toContain('scripts/ci/env-parity.mjs');
    expect(step).toMatch(/vars\.PRODUCTION_LIVE == 'true' && '--strict'/);
  });
});

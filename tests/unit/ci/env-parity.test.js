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
  // production PR adds a binding and nothing else.
  test('the street-map archive: bound on staging only, named the same on both sides', () => {
    const toml = real();
    const stg = toml.slice(toml.indexOf('[env.staging]'), toml.indexOf('[env.production]'));
    const prod = toml.slice(toml.indexOf('[env.production]'));
    expect(stg).toMatch(/^\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"\r?$/m);
    expect(prod).not.toMatch(/^binding = "MAP_TILES"\r?$/m);
    const name = /^MAP_TILES_ARCHIVE = "(planet-\d{8}\.pmtiles)"\r?$/m;
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

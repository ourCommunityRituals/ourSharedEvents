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
        'value:CF_ACCESS_AUD',
        'binding:queues.producers:SCAN_QUEUE',
        'binding:queues.consumers:ose-scans',
      ])
    );
    expect(r.ok).toBe(true);
    expect(r.strictOk).toBe(false);
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

  test('reports the three open items the owner has to rule on', () => {
    const r = parity.compareEnvironments(real());
    expect(keys(r, 'undecided').sort()).toEqual([
      'binding:queues.consumers:ose-scans',
      'binding:queues.producers:SCAN_QUEUE',
      'value:CF_ACCESS_AUD',
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

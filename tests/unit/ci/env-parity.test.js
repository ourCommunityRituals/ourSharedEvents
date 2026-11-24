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
  // production PR adds a binding and nothing else. That binding names the
  // bucket staging names: one bucket, read by both (owner 2026-11-14; the rule
  // is in "one bucket for both environments", below). The archive is the United
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
      '[[env.production.r2_buckets]]\nbinding = "MAP_TILES"\nbucket_name = "ose-map-tiles"\n\n[env.production.triggers]'
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
      expect(text).toMatch(/test\('NOT RUN \(street-map archive not loaded/);
      expect(text).not.toMatch(/console\.\w+\([^\n]*NOT RUN/);
      expect(text).toMatch(/streetMapArchiveLoaded is true for this environment/);
    }
  });

  test('the wrangler.toml these cases read is the one the parity check reads', () => {
    expect(parity.WRANGLER_PATH).toBe('workers/oursharedevents/wrangler.toml');
  });

  // Street-map scenario pass, gap G14: nobody had walked a refresh of the
  // archive ("Refreshing the archive" in the runbook) against these rules with
  // production bound. Each step below is the wrangler.toml text and the flag of
  // one pull request, in the runbook's order, put through the parity check
  // (compareEnvironments), the preflight's binding check
  // (checkProductionBindings) and the staging-first rule above
  // (orderProblems). Each test says what those checks do with that step TODAY.
  // It pins behaviour; it is not a rule. Which order a refresh should take with
  // production bound is the owner's (runbook, "Refreshing the archive").
  //
  // "Production bound" is the state the runbook's "Production, later" PR leaves:
  // a production MAP_TILES binding naming the staging bucket, and MAP_TILES
  // gone from DARK_ON_PRODUCTION. That PR also removes the open MAP_TILES entry
  // from UNDECIDED in env-parity.mjs. This file cannot edit that list, so the
  // parity check calls the entry stale on every bound step; the walk sets that
  // one finding aside (`STALE`) and step 0 shows it is the only one.
  // @born-red refresh walk with production bound | method: each fault below was injected and the named tests seen failing, then reverted: (1) orderProblems' rule "production binds MAP_TILES while the staging cases can still print NOT RUN" switched off: "step 1 as the runbook writes it" and "step 1 with production left on the old key" failed; (2) MAP_TILES_ARCHIVE added to INTENTIONAL_VALUE_DIFFERENCES in env-parity.mjs: "step 1 with production left on the old key" and "step 3 with production left on the old key" failed; (3) `withKey` made to change nothing: the six tests that move the key failed on its guard, step 0 passed; (4) the STALE filter widened to drop every unlisted finding: both "production left on the old key" tests failed; (5) orderProblems made to refuse any production binding: every walk test failed, the accepted steps on the new refusal; (6) the runbook without the walk's sentences (before they were written): "the runbook says which step is refused" failed | date: 2026-11-16
  describe('a refresh walked with production bound (scenario G14)', () => {
    const NEW_KEY = 'us-20991231.pmtiles';
    const STALE = 'stale-undecided:binding:r2_buckets:MAP_TILES';
    const keyIn = (toml, side) => {
      const at = toml.search(/^\[env\.production\]/m);
      const block = side === 'production' ? toml.slice(at) : toml.slice(0, at);
      return /^MAP_TILES_ARCHIVE = "([^"]*)"\r?$/m.exec(block)?.[1];
    };
    /** The key in one environment's block (staging's is the last before production's). */
    const withKey = (toml, side, key) => {
      const at = toml.search(/^\[env\.production\]/m);
      const line = /^MAP_TILES_ARCHIVE = "[^"]*"(\r?)$/m;
      const head = toml.slice(0, at);
      const tail = toml.slice(at);
      let out;
      if (side === 'production') {
        out = head + tail.replace(line, `MAP_TILES_ARCHIVE = "${key}"$1`);
      } else {
        const stgAt = head.search(/^\[env\.staging\]/m);
        out =
          head.slice(0, stgAt) +
          head.slice(stgAt).replace(line, `MAP_TILES_ARCHIVE = "${key}"$1`) +
          tail;
      }
      expect(keyIn(out, side), `${side} carries ${key}`).toBe(key);
      return out;
    };
    const both = (toml, key) => withKey(withKey(toml, 'staging', key), 'production', key);

    let DARK_TODAY;
    let checkProductionBindings;
    beforeAll(async () => {
      ({ DARK_ON_PRODUCTION: DARK_TODAY, checkProductionBindings } =
        await import('../../../scripts/prod-preflight.mjs'));
    });
    /** DARK_ON_PRODUCTION as the PR that binds production leaves it. */
    const darkBound = () => DARK_TODAY.filter((b) => b !== 'r2_buckets/MAP_TILES');

    /** What each check says of one step. Empty lists and "pass" are accepted. */
    function walk(toml, envYaml, dark) {
      const unlisted = parity
        .compareEnvironments(toml)
        .findings.filter((f) => f.level === 'unlisted')
        .map((f) => f.key);
      return {
        parity: unlisted.filter((k) => k !== STALE),
        preflight: checkProductionBindings(toml).status,
        order: orderProblems(toml, envYaml, dark),
      };
    }
    const ACCEPTED = { parity: [], preflight: 'pass', order: [] };
    const NOT_RUN_REFUSAL =
      'production binds MAP_TILES while the staging cases can still print NOT RUN: set streetMapArchiveLoaded to "true" first, in a PR whose staging run drew streets';

    // Production bound, archive seen on staging, both blocks on today's key.
    const start = () => withProduction(real());

    test('step 0, where a refresh starts (production bound, the archive seen): accepted', () => {
      const toml = start();
      expect(keyIn(toml, 'staging')).toBe(keyIn(toml, 'production'));
      expect(keyIn(toml, 'staging')).not.toBe(NEW_KEY);
      expect(
        parity
          .compareEnvironments(toml)
          .findings.filter((f) => f.level === 'unlisted')
          .map((f) => f.key)
      ).toEqual([STALE]);
      expect(walk(toml, withFlag(stagingEnv(), 'true'), darkBound())).toEqual(ACCEPTED);
    });

    test('step 1 as the runbook writes it (the new key in both blocks, the flag "false"): refused by the staging-first rule', () => {
      const toml = both(start(), NEW_KEY);
      expect(walk(toml, withFlag(stagingEnv(), 'false'), darkBound())).toEqual({
        parity: [],
        preflight: 'pass',
        order: [NOT_RUN_REFUSAL],
      });
    });

    test('step 1 with production left on the old key ("production moves at its own deploy"): refused by the parity check and the staging-first rule', () => {
      const toml = withKey(start(), 'staging', NEW_KEY);
      expect(walk(toml, withFlag(stagingEnv(), 'false'), darkBound())).toEqual({
        parity: ['value:MAP_TILES_ARCHIVE'],
        preflight: 'pass',
        order: [NOT_RUN_REFUSAL],
      });
    });

    test('step 1 with the flag left "true": accepted by these checks, while the flag says loaded for a key nothing has loaded', () => {
      const toml = both(start(), NEW_KEY);
      expect(walk(toml, withFlag(stagingEnv(), 'true'), darkBound())).toEqual(ACCEPTED);
    });

    // Step 2 is the load: the workflow run and the lock rule change no file here.

    test('step 3, the flag back to "true" with the new key in both blocks: accepted', () => {
      const toml = both(start(), NEW_KEY);
      expect(walk(toml, withFlag(stagingEnv(), 'true'), darkBound())).toEqual(ACCEPTED);
    });

    test('step 3 with production left on the old key: refused by the parity check', () => {
      const toml = withKey(start(), 'staging', NEW_KEY);
      expect(walk(toml, withFlag(stagingEnv(), 'true'), darkBound())).toEqual({
        parity: ['value:MAP_TILES_ARCHIVE'],
        preflight: 'pass',
        order: [],
      });
    });

    test('the one order these checks accept at every step: production unbound in step 1 and bound again after step 3', () => {
      // Unbound is today's wrangler.toml, DARK_ON_PRODUCTION and UNDECIDED as
      // they are on main, with the key moved in both blocks.
      const unbound = both(real(), NEW_KEY);
      expect(BINDS.production.test(unbound)).toBe(false);
      const step1 = walk(unbound, withFlag(stagingEnv(), 'false'), DARK_TODAY);
      const step3 = walk(unbound, withFlag(stagingEnv(), 'true'), DARK_TODAY);
      const rebound = walk(both(start(), NEW_KEY), withFlag(stagingEnv(), 'true'), darkBound());
      expect(step1).toEqual(ACCEPTED);
      expect(step3).toEqual(ACCEPTED);
      expect(rebound).toEqual(ACCEPTED);
    });

    test('the runbook says which step is refused with production bound, and names this walk', () => {
      const runbook = fs.readFileSync(
        path.join(__dirname, '../../../docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md'),
        'utf8'
      );
      const at = runbook.indexOf('## Refreshing the archive');
      const section = runbook.slice(at, runbook.indexOf('\n## ', at + 1)).replace(/\s+/g, ' ');
      expect(section).toContain('a refresh walked with production bound (scenario G14)');
      expect(section).toContain('Step 1 as written above is refused');
    });
  });
});

// Street-map CCR 2026-11-15, R20: the street layer has a switch the Worker
// reads, `STREET_MAP` in each vars block of wrangler.toml. Exactly "on" draws.
// The Worker treats a missing or mistyped value as off, which is safe and
// silent, so these rules make the value be written, and written as one of the
// two words. They also hold the two things that lean on it: the staging cases'
// flag (streetMapArchiveLoaded may not be "true" while staging is "off") and
// the copy the Bruno cases print (streetMapSwitch).
// @born-red street-layer switch | method: each rule is fed the fault that turns it red, in the cases below. Then the real files were faulted, one at a time, and "the real files agree" seen failing on each: staging set to "on" with the copy left at "off"; the copy set to "on"; staging mistyped "ON"; production's line removed (the parity check's own "no unlisted difference" failed too); production "on" with staging "off"; streetMapArchiveLoaded "true" with the switch off. STREET_MAP taken off INTENTIONAL_VALUE_DIFFERENCES failed "the parity check lists a staging-first difference"; STREET_MAP_ON set to 'true' failed "the word the rules call on"; the runbook's two sections with the value taken out each failed "the runbook names the switch". Watched again the day staging was set to "on" and the cases were made to start from a stated value: the real files faulted three ways (the copy left at "off"; staging back to "off" with the copy left; both back to "off") each failed "as it stands", and the first two "the real files agree"; the copy check, the flag check and the staging-first check switched off in turn each failed its own case; STREET_MAP taken off the list failed the parity case; the helper `at` made to set nothing failed four cases | date: 2026-11-15
describe('the street-layer switch (STREET_MAP)', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own files, by a path written in this file
  const root = (p) => fs.readFileSync(path.join(__dirname, '../../../', p), 'utf8');
  const STAGING_ENV = 'bruno/ose-pages/environments/ose-staging.yml';
  const RUNBOOK = 'docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md';
  const toml = () => root('workers/oursharedevents/wrangler.toml');
  const stagingEnv = () => root(STAGING_ENV);

  /** The three vars blocks, by the name the sentences use. */
  function blocks(tomlText) {
    const stgAt = tomlText.search(/^\[env\.staging\]/m);
    const prodAt = tomlText.search(/^\[env\.production\]/m);
    return {
      'local dev': tomlText.slice(0, stgAt),
      staging: tomlText.slice(stgAt, prodAt),
      production: tomlText.slice(prodAt),
    };
  }
  const valueIn = (block) => /^STREET_MAP = "([^"]*)"\r?$/m.exec(block)?.[1];

  /** What is wrong, as sentences. Pure: takes the two files' text and the Worker's on value. */
  function switchProblems(tomlText, envYaml, onValue = 'on') {
    const out = [];
    const value = {};
    for (const [name, block] of Object.entries(blocks(tomlText))) {
      value[name] = valueIn(block);
      if (value[name] === undefined) {
        out.push(`${name} has no STREET_MAP: write "on" or "off"`);
      } else if (value[name] !== onValue && value[name] !== 'off') {
        out.push(
          `${name} sets STREET_MAP to "${value[name]}": the Worker draws streets only for "${onValue}", so write "${onValue}" or "off"`
        );
      }
    }
    if (value.production === onValue && value.staging !== onValue) {
      out.push('production has STREET_MAP "on" and staging does not: staging goes first');
    }
    const loaded = /name: streetMapArchiveLoaded\r?\n\s+value: "([^"]*)"/.exec(envYaml)?.[1];
    if (loaded === 'true' && value.staging !== onValue) {
      out.push(
        'streetMapArchiveLoaded is "true" and staging has STREET_MAP off: the staging cases would demand streets the Worker is set not to draw'
      );
    }
    const copy = /name: streetMapSwitch\r?\n\s+value: "([^"]*)"/.exec(envYaml)?.[1];
    if (copy !== value.staging) {
      out.push(
        `${STAGING_ENV} says streetMapSwitch "${copy}" and wrangler.toml says STREET_MAP "${value.staging}" on staging: the Bruno cases would print the wrong word`
      );
    }
    return out;
  }

  const withValue = (tomlText, name, v) => {
    const b = blocks(tomlText);
    const changed = b[name].replace(/^STREET_MAP = "[^"]*"(\r?)$/m, `STREET_MAP = "${v}"$1`);
    expect(changed).not.toBe(b[name]);
    return { ...b, [name]: changed };
  };
  const join = (b) => b['local dev'] + b.staging + b.production;
  const set = (tomlText, name, v) => join(withValue(tomlText, name, v));
  const withCopy = (yaml, v) =>
    yaml.replace(/(name: streetMapSwitch\r?\n\s+value: )"[^"]*"/, `$1"${v}"`);
  const withFlag = (yaml, v) =>
    yaml.replace(/(name: streetMapArchiveLoaded\r?\n\s+value: )"(true|false)"/, `$1"${v}"`);
  // The cases below start from a stated value, not from whichever the real
  // files carry today, so they hold on both sides of the day staging is turned
  // on or back off. `set` insists the text changed; `at` insists only that the
  // line is there to set.
  const at = (tomlText, name, v) => {
    const b = blocks(tomlText);
    expect(valueIn(b[name]), `${name} has a STREET_MAP line`).toBeDefined();
    return join({
      ...b,
      [name]: b[name].replace(/^STREET_MAP = "[^"]*"(\r?)$/m, `STREET_MAP = "${v}"$1`),
    });
  };
  const stagingOff = () => at(at(toml(), 'staging', 'off'), 'production', 'off');
  const stagingOn = () => at(at(toml(), 'staging', 'on'), 'production', 'off');
  const copyOff = () => withFlag(withCopy(stagingEnv(), 'off'), 'false');
  const copyOn = () => withFlag(withCopy(stagingEnv(), 'on'), 'false');

  test('the real files agree', () => {
    expect(switchProblems(toml(), stagingEnv())).toEqual([]);
  });

  test('the word the rules call on is the word the Worker reads', () => {
    const src = root('workers/oursharedevents/src/lib/street-map.ts');
    expect(/^export const STREET_MAP_ON = '([^']*)';\r?$/m.exec(src)?.[1]).toBe('on');
    expect(src).toMatch(/^ {2}if \(env\?\.STREET_MAP !== STREET_MAP_ON\) return null;\r?$/m);
  });

  // The owner's choice, written down: on where only this machine sees the
  // page, on for staging (owner 2026-11-15, set before any archive was loaded),
  // off for production. A PR that turns staging back off, or production on,
  // changes a line here, and for staging the copy in the Bruno environment
  // file with it.
  test('as it stands: on for local dev, on for staging, off on production', () => {
    const b = blocks(toml());
    expect(valueIn(b['local dev'])).toBe('on');
    expect(valueIn(b.staging)).toBe('on');
    expect(valueIn(b.production)).toBe('off');
    expect(/name: streetMapSwitch\r?\n\s+value: "([^"]*)"/.exec(stagingEnv())?.[1]).toBe('on');
  });

  test('a block with no value, or a value that is neither word: refused', () => {
    for (const name of ['local dev', 'staging', 'production']) {
      const b = blocks(toml());
      const gone = join({ ...b, [name]: b[name].replace(/^STREET_MAP = /m, 'STREET_MAPS = ') });
      expect(switchProblems(gone, stagingEnv())).toContain(
        `${name} has no STREET_MAP: write "on" or "off"`
      );
      for (const typo of ['ON', 'true', '1', 'on ', '']) {
        expect(switchProblems(set(toml(), name, typo), stagingEnv()).join(' | ')).toContain(
          `${name} sets STREET_MAP to "${typo}": the Worker draws streets only for "on"`
        );
      }
    }
  });

  test('staging turned on, and the copy with it: in order; the copy left behind: refused', () => {
    expect(switchProblems(stagingOff(), copyOff())).toEqual([]);
    expect(switchProblems(stagingOn(), copyOn())).toEqual([]);
    expect(switchProblems(stagingOn(), copyOff())).toEqual([
      `${STAGING_ENV} says streetMapSwitch "off" and wrangler.toml says STREET_MAP "on" on staging: the Bruno cases would print the wrong word`,
    ]);
    expect(switchProblems(stagingOff(), copyOn())).toEqual([
      `${STAGING_ENV} says streetMapSwitch "on" and wrangler.toml says STREET_MAP "off" on staging: the Bruno cases would print the wrong word`,
    ]);
    expect(
      switchProblems(toml(), stagingEnv().replace('streetMapSwitch', 'renamed')).join(' ')
    ).toMatch(/says streetMapSwitch "undefined"/);
  });

  test('the staging cases made binding while the switch is off: refused', () => {
    expect(switchProblems(stagingOff(), withFlag(copyOff(), 'true'))).toEqual([
      'streetMapArchiveLoaded is "true" and staging has STREET_MAP off: the staging cases would demand streets the Worker is set not to draw',
    ]);
    expect(switchProblems(stagingOn(), withFlag(copyOn(), 'true'))).toEqual([]);
  });

  test('production on before staging: refused', () => {
    expect(switchProblems(at(stagingOff(), 'production', 'on'), copyOff())).toEqual([
      'production has STREET_MAP "on" and staging does not: staging goes first',
    ]);
    expect(switchProblems(at(stagingOn(), 'production', 'on'), copyOn())).toEqual([]);
  });

  test('the parity check lists a staging-first difference as intentional, not unlisted', () => {
    const same = parity.compareEnvironments(stagingOff());
    expect(same.findings.filter((f) => f.key === 'value:STREET_MAP')).toEqual([]);
    const stagingFirst = parity.compareEnvironments(stagingOn());
    expect(keys(stagingFirst, 'unlisted')).toEqual([]);
    expect(keys(stagingFirst, 'intentional')).toContain('value:STREET_MAP');
    // One side only is still unlisted: the value is written in both.
    const b = blocks(toml());
    const oneSide = parity.compareEnvironments(
      join({ ...b, production: b.production.replace(/^STREET_MAP = "[^"]*"\r?\n/m, '') })
    );
    expect(keys(oneSide, 'unlisted')).toContain('only-in-staging:STREET_MAP');
  });

  test('the runbook names the switch where the owner turns streets on and off', () => {
    const text = root(RUNBOOK);
    const section = (title) => {
      const from = text.indexOf(`\n## ${title}`);
      expect(from, title).toBeGreaterThan(-1);
      const to = text.indexOf('\n## ', from + 4);
      return text.slice(from, to < 0 ? undefined : to);
    };
    expect(section('Staging, in order')).toContain('`STREET_MAP = "on"`');
    expect(section('Back to hexagons only')).toContain('`STREET_MAP = "off"`');
    for (const title of ['Staging, in order', 'Back to hexagons only']) {
      // It is not the test flag, and the runbook says so in both places.
      expect(section(title)).toContain('streetMapSwitch');
      expect(section(title)).toContain('streetMapArchiveLoaded');
    }
  });
});

// OSE-2135 (S3c of OSE-1193; OSE ADR-040): the voting kill switch, `VOTING_ENABLED`
// in each vars block of wrangler.toml. Exactly "on" turns the public vote
// surfaces on; the Worker reads anything else as off, which is safe and silent,
// so these rules make the value be written, as one of the two words, in every
// block. Production may be "on" only once staging is, and the Bruno copy
// (votingSwitch, which picks the half of each voting Bruno folder that runs) must match
// staging. "As it stands" pins all three off: only the owner turns voting on,
// and that PR changes a line here.
// @born-red voting switch | method: each rule is fed the fault that turns it red, in the cases below. Then the real files were faulted one at a time and "the real files agree" or "as it stands" seen failing on each: production set to "on" with staging "off"; staging set to "on" with the copy left at "off"; the copy set to "on"; staging mistyped "ON"; production's line removed. VOTING_ENABLED taken off INTENTIONAL_VALUE_DIFFERENCES failed "the parity check lists a staging-first difference"; VOTING_ON set to 'true' failed "the word the rules call on" | date: 2026-11-18
describe('the voting kill switch (VOTING_ENABLED)', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own files, by a path written in this file
  const root = (p) => fs.readFileSync(path.join(__dirname, '../../../', p), 'utf8');
  const STAGING_ENV = 'bruno/ose-api/environments/ose-staging.yml';
  const toml = () => root('workers/oursharedevents/wrangler.toml');
  const stagingEnv = () => root(STAGING_ENV);
  const NAMES = ['local dev', 'staging', 'production'];

  function blocks(tomlText) {
    const stgAt = tomlText.search(/^\[env\.staging\]/m);
    const prodAt = tomlText.search(/^\[env\.production\]/m);
    return {
      'local dev': tomlText.slice(0, stgAt),
      staging: tomlText.slice(stgAt, prodAt),
      production: tomlText.slice(prodAt),
    };
  }
  const join = (b) => b['local dev'] + b.staging + b.production;
  const valueIn = (block) => /^VOTING_ENABLED = "([^"]*)"\r?$/m.exec(block)?.[1];
  const copyIn = (yaml) => /name: votingSwitch\r?\n\s+value: "([^"]*)"/.exec(yaml)?.[1];

  /** What is wrong, as sentences. Pure: takes the two files' text. */
  function switchProblems(tomlText, envYaml) {
    const out = [];
    const value = {};
    for (const [name, block] of Object.entries(blocks(tomlText))) {
      value[name] = valueIn(block);
      if (value[name] === undefined) {
        out.push(`${name} has no VOTING_ENABLED: write "on" or "off"`);
      } else if (value[name] !== 'on' && value[name] !== 'off') {
        out.push(
          `${name} sets VOTING_ENABLED to "${value[name]}": the Worker turns voting on only for "on", so write "on" or "off"`
        );
      }
    }
    if (value.production === 'on' && value.staging !== 'on') {
      out.push('production has VOTING_ENABLED "on" and staging does not: staging goes first');
    }
    const copy = copyIn(envYaml);
    if (copy !== value.staging) {
      out.push(
        `${STAGING_ENV} says votingSwitch "${copy}" and wrangler.toml says VOTING_ENABLED "${value.staging}" on staging: the voting Bruno folders would run the wrong half`
      );
    }
    return out;
  }

  /** The real file with one block's value replaced; the line must be there. */
  const at = (tomlText, name, v) => {
    const b = blocks(tomlText);
    expect(valueIn(b[name]), `${name} has a VOTING_ENABLED line`).toBeDefined();
    return join({
      ...b,
      [name]: b[name].replace(/^VOTING_ENABLED = "[^"]*"(\r?)$/m, `VOTING_ENABLED = "${v}"$1`),
    });
  };
  const withCopy = (yaml, v) => {
    const out = yaml.replace(/(name: votingSwitch\r?\n\s+value: )"[^"]*"/, `$1"${v}"`);
    expect(copyIn(out)).toBe(v);
    return out;
  };
  const allOff = () =>
    at(at(at(toml(), 'local dev', 'off'), 'staging', 'off'), 'production', 'off');
  const stagingOn = () => at(allOff(), 'staging', 'on');

  test('the real files agree', () => {
    expect(switchProblems(toml(), stagingEnv())).toEqual([]);
  });

  test('the word the rules call on is the word the Worker reads', () => {
    const src = root('workers/oursharedevents/src/lib/voting-switch.ts');
    expect(/^export const VOTING_ON = '([^']*)';\r?$/m.exec(src)?.[1]).toBe('on');
    expect(src).toMatch(/^ {2}return env\?\.VOTING_ENABLED === VOTING_ON;\r?$/m);
  });

  // The owner's rule (OSE-2135 DevOps gate): off on staging and production, on
  // only where the owner turns it on. Off for local dev too, so a test that
  // needs it on says so.
  // Owner, 2026-11-24 (OSE-2227): on for staging only. Local dev and the
  // workers test pool stay off; production stays off until the owner says so.
  test('as it stands: off for local dev, on for staging, off on production', () => {
    const b = blocks(toml());
    const want = { staging: 'on' };
    for (const name of NAMES) expect(valueIn(b[name]), name).toBe(want[name] ?? 'off');
    expect(copyIn(stagingEnv())).toBe('on');
  });

  test('a block with no value, or a value that is neither word: refused', () => {
    for (const name of NAMES) {
      const b = blocks(allOff());
      const gone = join({
        ...b,
        [name]: b[name].replace(/^VOTING_ENABLED = /m, 'VOTING_ENABLE = '),
      });
      expect(switchProblems(gone, stagingEnv())).toContain(
        `${name} has no VOTING_ENABLED: write "on" or "off"`
      );
      for (const typo of ['ON', 'true', '1', 'on ', 'yes', '']) {
        expect(switchProblems(at(allOff(), name, typo), stagingEnv()).join(' | ')).toContain(
          `${name} sets VOTING_ENABLED to "${typo}": the Worker turns voting on only for "on"`
        );
      }
    }
  });

  test('production on before staging: refused; after staging: in order', () => {
    expect(switchProblems(at(allOff(), 'production', 'on'), withCopy(stagingEnv(), 'off'))).toEqual(
      ['production has VOTING_ENABLED "on" and staging does not: staging goes first']
    );
    expect(
      switchProblems(at(stagingOn(), 'production', 'on'), withCopy(stagingEnv(), 'on'))
    ).toEqual([]);
  });

  test('staging turned on, and the copy with it: in order; the copy left behind: refused', () => {
    expect(switchProblems(allOff(), withCopy(stagingEnv(), 'off'))).toEqual([]);
    expect(switchProblems(stagingOn(), withCopy(stagingEnv(), 'on'))).toEqual([]);
    expect(switchProblems(stagingOn(), withCopy(stagingEnv(), 'off'))).toEqual([
      `${STAGING_ENV} says votingSwitch "off" and wrangler.toml says VOTING_ENABLED "on" on staging: the voting Bruno folders would run the wrong half`,
    ]);
    expect(switchProblems(allOff(), withCopy(stagingEnv(), 'on'))).toEqual([
      `${STAGING_ENV} says votingSwitch "on" and wrangler.toml says VOTING_ENABLED "off" on staging: the voting Bruno folders would run the wrong half`,
    ]);
  });

  test('the parity check lists a staging-first difference as intentional, not unlisted', () => {
    const same = parity.compareEnvironments(allOff());
    expect(same.findings.filter((f) => f.key === 'value:VOTING_ENABLED')).toEqual([]);
    const stagingFirst = parity.compareEnvironments(stagingOn());
    expect(keys(stagingFirst, 'unlisted')).toEqual([]);
    expect(keys(stagingFirst, 'intentional')).toContain('value:VOTING_ENABLED');
    // One side only is still unlisted: the value is written in both.
    const b = blocks(allOff());
    const oneSide = parity.compareEnvironments(
      join({ ...b, production: b.production.replace(/^VOTING_ENABLED = "[^"]*"\r?\n/m, '') })
    );
    expect(keys(oneSide, 'unlisted')).toContain('only-in-staging:VOTING_ENABLED');
  });
});

// Fat fingers (owner 2026-11-10). The bucket and the object key are typed by
// hand: in wrangler.toml, and in the commands the runbook shows, which since
// 2026-11-14 are the ones the load workflow runs, not ones the owner types
// (tests/unit/ci/street-map-archive-load.test.js holds the workflow to them) (check
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
    // One bucket, read by both environments (owner 2026-11-14). Production,
    // once it is bound, names the bucket staging names, and no other binding
    // in the file names it: not local dev's, not the uploads buckets'.
    const prodBinds = /^\[\[env\.production\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"\r?$/m.test(
      tomlText
    );
    const prodBucket =
      /^\[\[env\.production\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"\r?\nbucket_name = "([^"]*)"/m.exec(
        tomlText
      )?.[1];
    if (prodBinds && prodBucket !== bucket) {
      out.push(
        `production binds MAP_TILES to "${prodBucket}" and staging to "${bucket}": the two read one bucket`
      );
    }
    const named = [...tomlText.matchAll(/^bucket_name = "([^"]*)"\r?$/gm)].filter(
      (m) => m[1] === bucket
    ).length;
    if (named > (prodBinds && prodBucket === bucket ? 2 : 1)) {
      out.push(
        `"${bucket}" is named by a binding other than MAP_TILES on staging and on production`
      );
    }
    // The owner creates the bucket, so the runbook reads its settings and
    // does not take them on trust: no r2.dev URL, no custom domain.
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
    expect(rule.test('us-20261120.pmtiles')).toBe(true);
    expect(rule.test('../us-20261120.pmtiles')).toBe(false);
  });

  test.each([
    ['a letter dropped from the bucket', 'ose-map-tiles', 'ose-map-tile'],
    ['the dev bucket copied down', 'ose-map-tiles', 'ose-map-tiles-dev'],
    ['a capital in the bucket', 'ose-map-tiles', 'Ose-map-tiles'],
    ['an underscore in the bucket', 'ose-map-tiles', 'ose_map_tiles'],
    ['the name of before 2026-11-14 left in', 'ose-map-tiles', 'ose-map-tiles-staging'],
    ['the uploads bucket copied down', 'ose-map-tiles', 'ose-uploads-staging'],
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
    ['two digits of the date swapped', 'us-20261151.pmtiles'],
    ['the extension in capitals', 'us-20261120.PMTILES'],
    ['a capital in the name', 'US-20261120.pmtiles'],
    ['a space after', 'us-20261120.pmtiles '],
    ['the bucket pasted in front', 'ose-map-tiles/us-20261120.pmtiles'],
    ['the planet name of 2026-11-09 left in', 'planet-20261109.pmtiles'],
  ])('fat finger in wrangler.toml: the archive name with %s', (_, to) => {
    const stgAt = toml().search(/^\[env\.staging\]/m);
    const text =
      toml().slice(0, stgAt) +
      toml()
        .slice(stgAt)
        .replace('MAP_TILES_ARCHIVE = "us-20261120.pmtiles"', `MAP_TILES_ARCHIVE = "${to}"`);
    expect(text).not.toBe(toml());
    expect(nameProblems(text, runbook(), workerRule())).not.toEqual([]);
  });

  test.each([
    [
      'the upload key with two digits swapped',
      'r2:ose-map-tiles/us-20261120.pmtiles',
      'r2:ose-map-tiles/us-20261151.pmtiles',
    ],
    [
      'the upload to the bucket of before 2026-11-14',
      'r2:ose-map-tiles/us-20261120.pmtiles',
      'r2:ose-map-tiles-staging/us-20261120.pmtiles',
    ],
    [
      'the upload under the bare build name',
      'r2:ose-map-tiles/us-20261120.pmtiles',
      'r2:ose-map-tiles/20261120.pmtiles',
    ],
    [
      'the upload under the planet key of 2026-11-09',
      'r2:ose-map-tiles/us-20261120.pmtiles',
      'r2:ose-map-tiles/planet-20261109.pmtiles',
    ],
    [
      'a whole build uploaded in place of the extract',
      'rclone copyto us-20261120.pmtiles',
      'rclone copyto 20261120.pmtiles',
    ],
    [
      'the extract written under another name',
      '20261120.pmtiles us-20261120.pmtiles --region',
      '20261120.pmtiles usa-20261120.pmtiles --region',
    ],
    [
      'the extract cut from another build',
      'build.protomaps.com/20261120.pmtiles us-',
      'build.protomaps.com/20261114.pmtiles us-',
    ],
    [
      'another bucket checked for a public URL',
      'dev-url get ose-map-tiles',
      'dev-url get ose-map-tiles-stg',
    ],
    [
      'another bucket checked for a custom domain',
      'domain list ose-map-tiles',
      'domain list ose-uploads-staging',
    ],
    [
      'a command that turns the public URL on, added under the checks',
      'domain list ose-map-tiles',
      'domain list ose-map-tiles\n   npx wrangler r2 bucket dev-url enable ose-map-tiles',
    ],
    [
      'a command that gives the bucket a custom domain, added under the checks',
      'domain list ose-map-tiles',
      'domain list ose-map-tiles\n   npx wrangler r2 bucket domain add ose-map-tiles',
    ],
    ['the token scoped to another bucket', '`ose-map-tiles` only', '`ose-uploads-staging` only'],
    [
      'the check run on a file of another date',
      'check-street-map-archive.mjs us-20261120.pmtiles',
      'check-street-map-archive.mjs us-20261151.pmtiles',
    ],
    [
      'the check run on the whole build',
      'check-street-map-archive.mjs us-20261120.pmtiles',
      'check-street-map-archive.mjs 20261120.pmtiles',
    ],
    [
      'the check command dropped',
      'node workers/oursharedevents/scripts/check-street-map-archive.mjs us-20261120.pmtiles',
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
      'node workers/oursharedevents/scripts/check-street-map-archive.mjs us-20261120.pmtiles';
    const upload =
      'rclone copyto us-20261120.pmtiles r2:ose-map-tiles/us-20261120.pmtiles --immutable --s3-chunk-size=256M --stats=1m --stats-one-line -v';
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

  // One bucket, read by both environments (owner 2026-11-14). Until that day
  // the rule here was the opposite one ("staging must have a bucket of its
  // own"), so a production binding to the same bucket was red.
  // @born-red street-map one bucket | method: three faults in nameProblems, one at a time: the one-bucket rule switched off (the four "production bound to ...: refused" cases went red), the no-other-binding rule switched off (the three "names the street-map bucket too" cases went red), the rule of before 2026-11-14 put back as `named > 1` ("production bound to the bucket staging binds: no problem" went red) | date: 2026-11-14
  describe('one bucket for both environments', () => {
    const bound = (bucket) =>
      toml().replace(
        /^\[env\.production\.triggers\]/m,
        `[[env.production.r2_buckets]]\nbinding = "MAP_TILES"\nbucket_name = "${bucket}"\n\n[env.production.triggers]`
      );

    test('production bound to the bucket staging binds: no problem', () => {
      expect(bound('ose-map-tiles')).not.toBe(toml());
      expect(nameProblems(bound('ose-map-tiles'), runbook(), workerRule())).toEqual([]);
    });

    test.each([
      ['a bucket of its own', 'ose-map-tiles-production'],
      ['the bucket of before 2026-11-14', 'ose-map-tiles-staging'],
      ['the local dev bucket', 'ose-map-tiles-dev'],
    ])('production bound to %s: refused', (_, bucket) => {
      expect(nameProblems(bound(bucket), runbook(), workerRule())).toContain(
        `production binds MAP_TILES to "${bucket}" and staging to "ose-map-tiles": the two read one bucket`
      );
    });

    test('production bound with no bucket name: refused', () => {
      const text = bound('x').replace(
        'binding = "MAP_TILES"\nbucket_name = "x"\n',
        'binding = "MAP_TILES"\n'
      );
      expect(text).not.toBe(bound('x'));
      expect(nameProblems(text, runbook(), workerRule())).toContain(
        'production binds MAP_TILES to "undefined" and staging to "ose-map-tiles": the two read one bucket'
      );
    });

    test.each([
      ['the staging uploads binding', 'bucket_name = "ose-uploads-staging"'],
      ['the production uploads binding', 'bucket_name = "ose-uploads-production"'],
      ['the local dev street-map binding', 'bucket_name = "ose-map-tiles-dev"'],
    ])('%s names the street-map bucket too: refused, bound on production or not', (_, line) => {
      const want =
        '"ose-map-tiles" is named by a binding other than MAP_TILES on staging and on production';
      for (const text of [toml(), bound('ose-map-tiles')]) {
        expect(text).toContain(line);
        const slipped = text.replace(line, 'bucket_name = "ose-map-tiles"');
        expect(nameProblems(slipped, runbook(), workerRule())).toContain(want);
      }
    });
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

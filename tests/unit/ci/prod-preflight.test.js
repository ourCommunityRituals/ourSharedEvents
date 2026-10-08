/**
 * Production preflight: every check is a pure function of text it is handed.
 *
 * `scripts/prod-preflight.mjs` is what the founder runs before dispatching the
 * production deploy. These tests feed each check a fixture and, for each one,
 * the fault that must turn it red. Nothing here reaches the network, reads a
 * credential or runs wrangler.
 *
 * Root vitest loads test files as scripts, so the ESM module is imported
 * dynamically.
 */

let pf;

beforeAll(async () => {
  pf = await import('../../../scripts/prod-preflight.mjs');
});

// ── fixtures ────────────────────────────────────────────────────────────────

const TOML = `
name = "oursharedevents"

[[d1_databases]]
binding = "DB"
database_name = "ocr-db-local"
database_id = "local"

[vars]
WORKER_ENV = "development"
WORKER_BUILD_VERSION = "dev-local"

[env.staging]
name = "oursharedevents-stg"
routes = [
  { pattern = "stg.oursharedevents.com/*", zone_name = "oursharedevents.com" }
]

[[env.staging.d1_databases]]
binding = "DB"
database_name = "ocr-db-staging"
database_id = "stg-db-id"

[[env.staging.d1_databases]]
binding = "FORMS_DB"
database_name = "ocr-forms-db-staging"
database_id = "stg-forms-id"

[[env.staging.kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "stg-kv-id"

[[env.staging.ratelimits]]
name = "FORM_EDGE_LIMITER"
namespace_id = "15094"

[[env.staging.queues.producers]]
binding = "SCAN_QUEUE"
queue   = "ose-scans"

[env.staging.triggers]
crons = ["0 3 * * *"]

[env.staging.vars]
WORKER_ENV = "staging"
WORKER_BUILD_VERSION = "stg-2026.03.22"
PUBLISH_GRACE_MINUTES = "10"
ADMIN_SCOPE_ALL = "true"
ALLOW_OCR_INTERNAL = "true"
ALLOWED_ADMIN_EMAILS = "founder@example.test"
CF_ACCESS_TEAM_DOMAIN = "team.example.test"
BIGQUERY_DATASET_ID = "oursharedevents_backup_stg"

# ADMIN_SCOPE_ALL = "true" in a comment is not a setting
[env.production]
name = "oursharedevents-prod"
routes = [
  { pattern = "oursharedevents.com/*",     zone_name = "oursharedevents.com" },
  { pattern = "www.oursharedevents.com/*", zone_name = "oursharedevents.com" }
]

[[env.production.d1_databases]]
binding = "DB"
database_name = "ocr-db-production"
database_id = "prod-db-id"

[[env.production.d1_databases]]
binding = "FORMS_DB"
database_name = "ocr-forms-db-production"
database_id = "prod-forms-id"

[[env.production.kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "prod-kv-id"

[[env.production.ratelimits]]
name = "FORM_EDGE_LIMITER"
namespace_id = "15096"

[env.production.triggers]
crons = ["0 3 * * *"]

[env.production.vars]
WORKER_ENV = "production"
WORKER_BUILD_VERSION = "prod-2026.03.22"
PUBLISH_GRACE_MINUTES = "10"
# ALLOW_OCR_INTERNAL = "true" is deliberately absent here; a comment is not a setting
ALLOWED_ADMIN_EMAILS = "founder@example.test"
CF_ACCESS_TEAM_DOMAIN = "team.example.test"
BIGQUERY_DATASET_ID = "oursharedevents_backup"
`;

/** Replace one exact piece of the fixture; fails the test if it is not there. */
function swap(text, from, to) {
  expect(text.includes(from), `fixture has: ${from}`).toBe(true);
  return text.replace(from, to);
}

const files = (n) =>
  Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(4, '0')}_step.sql`);
const GUARD =
  'export const REQUIRED_DB_MIGRATION = 5;\nexport const REQUIRED_FORMS_MIGRATION = 3;\n';

const SECRETS_OK = JSON.stringify(
  [
    'FORMS_ENCRYPTION_KEY',
    'FORMS_HASH_PEPPER',
    'SHARED_REPORT_SIGNING_SECRET',
    'RATE_LIMIT_KEY_PEPPER',
    'GOOGLE_MAPS_API_KEY',
  ].map((name) => ({ name, type: 'secret_text' })),
  null,
  2
);

const PENDING = (names) =>
  [
    'Migrations to be applied:',
    '┌──────┐',
    '│ Name │',
    ...names.map((n) => `│ ${n} │`),
    '└──────┘',
  ].join('\n');

const RUN = (over = {}) =>
  JSON.stringify({
    headSha: 'abc1234' + '0'.repeat(33),
    headBranch: 'main',
    event: 'push',
    conclusion: 'success',
    jobs: [
      { name: 'S0 Security', conclusion: 'success' },
      { name: 'T1 Deploy → Staging', conclusion: 'success' },
      { name: 'T2 Contract → Staging (Bruno)', conclusion: 'success' },
      { name: 'T3 E2E Smoke → Staging (Playwright)', conclusion: 'success' },
      { name: 'T4 Functional → Staging', conclusion: 'success' },
    ],
    ...over,
  });

// ── text decoding and TOML reading ──────────────────────────────────────────

describe('reading operator files', () => {
  test('UTF-8, UTF-8 with a mark, and the UTF-16 that Windows PowerShell writes all read the same', () => {
    const text = 'No migrations to apply!';
    expect(pf.decodeText(Buffer.from(text, 'utf8'))).toBe(text);
    expect(pf.decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]))).toBe(
      text
    );
    expect(
      pf.decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
    ).toBe(text);
  });

  test('the TOML reader ignores comments and reads values across Windows line endings', () => {
    const sections = pf.parseToml(TOML.replace(/\n/g, '\r\n'));
    const vars = sections.find((s) => s.header === 'env.production.vars');
    expect(vars.values.WORKER_ENV).toBe('production');
    expect(vars.values).not.toHaveProperty('ADMIN_SCOPE_ALL');
    expect(vars.values).not.toHaveProperty('ALLOW_OCR_INTERNAL');
    expect(Object.keys(vars.values)).toHaveLength(6);
    expect(sections.filter((s) => s.header === 'env.production.d1_databases')).toHaveLength(2);
    expect(sections.find((s) => s.header === 'env.production').values.routes).toContain(
      'www.oursharedevents.com/*'
    );
  });

  test('a header with a comment after it, and a value with a comment after it, are both read', () => {
    const sections = pf.parseToml(
      '[env.production.vars] # production\nLIMIT = 5 # per minute\nNAME = "a # b"\n'
    );
    expect(sections[1]).toEqual({
      header: 'env.production.vars',
      array: false,
      values: { LIMIT: '5', NAME: 'a # b' },
    });
  });
});

// ── repo checks ─────────────────────────────────────────────────────────────

describe('schema constants match the migration files', () => {
  const ok = () => ({ db: files(5), forms: files(3), guardSource: GUARD });

  test('passes when both constants equal the highest file and the numbers have no holes', () => {
    const r = pf.checkSchemaConstants(ok());
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('main 5');
    expect(r.detail).toContain('forms 3');
  });

  test('fault: a migration was added and the main constant was not raised', () => {
    const r = pf.checkSchemaConstants({ ...ok(), db: files(6) });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('REQUIRED_DB_MIGRATION is 5');
    expect(r.detail).toContain('highest file is 6');
  });

  test('fault: the forms constant is ahead of its files', () => {
    const r = pf.checkSchemaConstants({ ...ok(), forms: files(2) });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('REQUIRED_FORMS_MIGRATION is 3');
  });

  test('fault: a number is missing, so the applied count can never reach the constant', () => {
    const r = pf.checkSchemaConstants({
      ...ok(),
      db: files(5).filter((f) => !f.startsWith('0003')),
    });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('0003');
  });

  test('fault: two files share a number', () => {
    const r = pf.checkSchemaConstants({ ...ok(), db: [...files(5), '0004_again.sql'] });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('0004');
  });

  test('fault: a constant cannot be found', () => {
    const r = pf.checkSchemaConstants({ ...ok(), guardSource: 'export const OTHER = 1;' });
    expect(r.status).toBe('fail');
  });

  test('files that are not migrations are ignored', () => {
    expect(pf.checkSchemaConstants({ ...ok(), db: [...files(5), 'ROLLBACK_PLAN.md'] }).status).toBe(
      'pass'
    );
  });
});

describe('production bindings', () => {
  test('passes on a complete production section', () => {
    expect(pf.checkProductionBindings(TOML).status).toBe('pass');
  });

  test('fault: a placeholder id', () => {
    const r = pf.checkProductionBindings(swap(TOML, 'id = "prod-kv-id"', 'id = "PROVISION_ME"'));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('PROVISION_ME');
  });

  test('fault: production points at the staging database', () => {
    const r = pf.checkProductionBindings(
      swap(TOML, 'database_id = "prod-db-id"', 'database_id = "stg-db-id"')
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('stg-db-id');
    expect(r.detail).toContain('staging');
  });

  test('fault: production points at the local development database', () => {
    const r = pf.checkProductionBindings(
      swap(TOML, 'database_id = "prod-db-id"', 'database_id = "local"')
    );
    expect(r.status).toBe('fail');
  });

  test('fault: a binding staging has is missing on production', () => {
    const r = pf.checkProductionBindings(
      swap(
        TOML,
        '[[env.production.kv_namespaces]]\nbinding = "RATE_LIMIT_KV"\nid = "prod-kv-id"\n',
        ''
      )
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('RATE_LIMIT_KV');
  });

  test('the scan queue is allowed to be staging only', () => {
    expect(pf.checkProductionBindings(TOML).detail).not.toContain('SCAN_QUEUE');
  });

  test('fault: there is no production section at all', () => {
    const r = pf.checkProductionBindings(TOML.split('[env.production]')[0]);
    expect(r.status).toBe('fail');
    expect(r.detail).toBe('wrangler.toml has no [env.production] section');
  });
});

describe('production settings', () => {
  test('passes on a complete production section', () => {
    expect(pf.checkProductionVars(TOML).status).toBe('pass');
  });

  test.each(['ADMIN_SCOPE_ALL', 'ALLOW_OCR_INTERNAL', 'ALLOW_ADMIN_KEY_FALLBACK', 'ADMIN_KEY'])(
    'fault: %s is set on production',
    (name) => {
      const r = pf.checkProductionVars(`${TOML}${name} = "true"\n`);
      expect(r.status).toBe('fail');
      expect(r.detail).toContain(name);
    }
  );

  test('fault: WORKER_ENV is not exactly production', () => {
    const r = pf.checkProductionVars(
      swap(TOML, 'WORKER_ENV = "production"', 'WORKER_ENV = "Production"')
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('WORKER_ENV');
  });

  test('fault: the Cloudflare Access team domain is empty', () => {
    const r = pf.checkProductionVars(
      TOML.replace(
        /(\[env\.production\.vars\][\s\S]*)CF_ACCESS_TEAM_DOMAIN = "team\.example\.test"/,
        '$1CF_ACCESS_TEAM_DOMAIN = ""'
      )
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('CF_ACCESS_TEAM_DOMAIN');
  });

  test('fault: nobody is allowed into admin (the setting is there but empty)', () => {
    const r = pf.checkProductionVars(
      TOML.replace(
        /(\[env\.production\.vars\][\s\S]*)ALLOWED_ADMIN_EMAILS = "founder@example\.test"\n/,
        '$1ALLOWED_ADMIN_EMAILS = ""\n'
      )
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toBe(
      'ALLOWED_ADMIN_EMAILS and ALLOWED_ADMIN_DOMAINS are both empty, so nobody is an admin'
    );
  });

  test('an allowed domain is enough when no single email is listed', () => {
    const r = pf.checkProductionVars(
      TOML.replace(
        /(\[env\.production\.vars\][\s\S]*)ALLOWED_ADMIN_EMAILS = "founder@example\.test"\n/,
        '$1ALLOWED_ADMIN_EMAILS = ""\nALLOWED_ADMIN_DOMAINS = "example.test"\n'
      )
    );
    expect(r.status).toBe('pass');
  });

  test('fault: production writes to the staging BigQuery dataset', () => {
    const r = pf.checkProductionVars(
      swap(
        TOML,
        'BIGQUERY_DATASET_ID = "oursharedevents_backup"\n',
        'BIGQUERY_DATASET_ID = "oursharedevents_backup_stg"\n'
      )
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('BIGQUERY_DATASET_ID');
  });

  test('fault: a production setting points at staging', () => {
    const r = pf.checkProductionVars(`${TOML}WIF_ISSUER = "https://stg.oursharedevents.com"\n`);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('WIF_ISSUER points at staging');
  });

  test('a value that only contains the letters "stg" inside a word is not staging', () => {
    expect(pf.checkProductionVars(`${TOML}SOME_LABEL = "postgres-host"\n`).status).toBe('pass');
  });

  test('it notes when the Access audience is not pinned, without failing', () => {
    expect(pf.checkProductionVars(TOML).detail).toContain('CF_ACCESS_AUD is empty');
    expect(pf.checkProductionVars(`${TOML}CF_ACCESS_AUD = "abc123"\n`).detail).not.toContain(
      'CF_ACCESS_AUD'
    );
  });

  test('fault: staging has a setting production does not (named environments inherit nothing)', () => {
    const r = pf.checkProductionVars(
      TOML.replace(/(\[env\.production\.vars\][\s\S]*)PUBLISH_GRACE_MINUTES = "10"\n/, '$1')
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('PUBLISH_GRACE_MINUTES');
  });
});

describe('production name, routes and nightly job', () => {
  test('passes on a complete production section', () => {
    expect(pf.checkProductionRoutes(TOML).status).toBe('pass');
  });

  test('fault: the Worker name changed', () => {
    const r = pf.checkProductionRoutes(
      swap(TOML, 'name = "oursharedevents-prod"', 'name = "ose-prod"')
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('ose-prod');
  });

  test('fault: a production route points at the staging host', () => {
    const r = pf.checkProductionRoutes(
      swap(TOML, 'pattern = "www.oursharedevents.com/*"', 'pattern = "stg.oursharedevents.com/*"')
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('stg.oursharedevents.com');
  });

  test('fault: the route for the main production host is gone', () => {
    const r = pf.checkProductionRoutes(
      swap(
        TOML,
        '  { pattern = "oursharedevents.com/*",     zone_name = "oursharedevents.com" },\n',
        ''
      )
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('no route for oursharedevents.com/*');
  });

  test('fault: production has no nightly job', () => {
    const r = pf.checkProductionRoutes(
      swap(TOML, '[env.production.triggers]\ncrons = ["0 3 * * *"]\n', '')
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('nightly');
  });
});

describe('build stamp', () => {
  test('passes when exactly one line matches what the deploy step rewrites', () => {
    expect(pf.checkBuildStamp(TOML).status).toBe('pass');
  });

  test('fault: the line was re-aligned, so the deploy step would rewrite nothing', () => {
    const r = pf.checkBuildStamp(
      swap(
        TOML,
        'WORKER_BUILD_VERSION = "prod-2026.03.22"',
        'WORKER_BUILD_VERSION  = "prod-2026.03.22"'
      )
    );
    expect(r.status).toBe('fail');
  });

  test('fault: the placeholder lost its prod- prefix', () => {
    const r = pf.checkBuildStamp(
      swap(TOML, 'WORKER_BUILD_VERSION = "prod-2026.03.22"', 'WORKER_BUILD_VERSION = "2026.03.22"')
    );
    expect(r.status).toBe('fail');
  });

  test('fault: the only matching line is a comment, not the production setting', () => {
    const r = pf.checkBuildStamp(
      swap(
        TOML,
        'WORKER_BUILD_VERSION = "prod-2026.03.22"',
        '# was: WORKER_BUILD_VERSION = "prod-2026.03.22"\nWORKER_BUILD_VERSION = "2026.03.22"'
      )
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('not the one in [env.production.vars]');
  });

  test('fault: a second line matches, so staging or dev would be stamped as production', () => {
    const r = pf.checkBuildStamp(
      swap(
        TOML,
        'WORKER_BUILD_VERSION = "stg-2026.03.22"',
        'WORKER_BUILD_VERSION = "prod-2026.03.22"'
      )
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('2');
  });
});

// ── checks that need a file the operator made ───────────────────────────────

describe('production secrets (names only)', () => {
  test('no file yet: not checked, and it says which command makes the file', () => {
    const r = pf.checkSecrets(undefined);
    expect(r.status).toBe('todo');
    expect(r.fix).toContain('wrangler secret list --env production');
  });

  test('passes when the four required names are there and no static admin credential is', () => {
    expect(pf.checkSecrets(SECRETS_OK).status).toBe('pass');
  });

  test.each([
    'FORMS_ENCRYPTION_KEY',
    'FORMS_HASH_PEPPER',
    'SHARED_REPORT_SIGNING_SECRET',
    'RATE_LIMIT_KEY_PEPPER',
  ])('fault: %s is missing', (name) => {
    const r = pf.checkSecrets(SECRETS_OK.replace(`"${name}"`, '"SOMETHING_ELSE"'));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain(name);
    expect(r.fix).toContain('set-secrets.sh production');
  });

  test.each(['ADMIN_KEY', 'X_OCR_INTERNAL', 'ADMIN_TOKEN'])('fault: %s is set', (name) => {
    const r = pf.checkSecrets(SECRETS_OK.replace('"GOOGLE_MAPS_API_KEY"', `"${name}"`));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain(name);
    expect(r.fix).toContain(`wrangler secret delete ${name} --env production`);
  });

  test('a longer name that contains a forbidden one is not a match', () => {
    expect(
      pf.checkSecrets(SECRETS_OK.replace('"GOOGLE_MAPS_API_KEY"', '"STAGING_ADMIN_KEY_NOTE"'))
        .status
    ).toBe('pass');
  });

  test('a banner or a notice printed around the list does not hide the names', () => {
    const noisy = `wrangler 4.145.0 [update available]\n${SECRETS_OK}\nDone [1]`;
    expect(pf.checkSecrets(noisy).status).toBe('pass');
    expect(pf.checkSecrets(noisy.replace('"FORMS_HASH_PEPPER"', '"OTHER"')).status).toBe('fail');
  });

  test('an empty list is a list: every required name is missing', () => {
    const r = pf.checkSecrets('[]');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('missing: SHARED_REPORT_SIGNING_SECRET');
  });

  test('fault: the file is not a secret list (wrangler printed an error instead)', () => {
    const r = pf.checkSecrets('Authentication error [code: 10000]');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('not a secret list');
  });

  test('nothing from the file is repeated, whatever it holds', () => {
    const r = pf.checkSecrets('FORMS_ENCRYPTION_KEY=hunter2-not-a-real-value\n');
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
});

describe('migrations production still has to apply', () => {
  const base = { binding: 'DB', files: files(5), required: 5 };

  test('no file yet: not checked', () => {
    const r = pf.checkPendingMigrations({ ...base, text: undefined });
    expect(r.status).toBe('todo');
    expect(r.fix).toContain('wrangler d1 migrations list DB --env production --remote');
  });

  test('nothing to apply: production is already at the level the build needs', () => {
    const r = pf.checkPendingMigrations({ ...base, text: '✅ No migrations to apply!' });
    expect(r.status).toBe('pass');
    expect(r.level).toBe(5);
    expect(r.pending).toEqual([]);
  });

  test('a clean tail to apply: says the level and the range', () => {
    const r = pf.checkPendingMigrations({
      ...base,
      text: PENDING(['0004_step.sql', '0005_step.sql']),
    });
    expect(r.status).toBe('pass');
    expect(r.level).toBe(3);
    expect(r.pending).toEqual(['0004_step.sql', '0005_step.sql']);
    expect(r.detail).toContain('at 3');
    expect(r.detail).toContain('needs 5');
    expect(r.detail).toContain('0004');
    expect(r.detail).toContain('0005');
  });

  test('fault: the list has a hole (an older migration never ran)', () => {
    const r = pf.checkPendingMigrations({
      ...base,
      text: PENDING(['0002_step.sql', '0005_step.sql']),
    });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('DB');
  });

  test('fault: the list does not reach the level the build needs', () => {
    const r = pf.checkPendingMigrations({ ...base, text: PENDING(['0004_step.sql']) });
    expect(r.status).toBe('fail');
  });

  test('fault: the list names a file this checkout does not have', () => {
    const r = pf.checkPendingMigrations({
      ...base,
      text: PENDING(['0005_step.sql', '0006_other.sql']),
    });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('0006_other.sql');
  });

  test('fault: wrangler could not answer', () => {
    const r = pf.checkPendingMigrations({ ...base, text: 'Authentication error [code: 10000]' });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('could not be read');
  });

  test('fault: an empty file (the error went to the screen, not the file)', () => {
    expect(pf.checkPendingMigrations({ ...base, text: '' }).status).toBe('fail');
  });
});

describe('what a migration does to rows that already exist', () => {
  test('finds deletes, updates, dropped tables and inserts, and ignores comments', () => {
    const sql = [
      '-- UPDATE nothing SET a = 1; (a comment)',
      'ALTER TABLE events ADD COLUMN x TEXT;',
      'UPDATE sponsor_business',
      '   SET tier = NULL;',
      'delete from events where id = 1;',
      'DROP TABLE sponsor_asset;',
      'INSERT INTO sponsor_asset_new (id) SELECT id FROM sponsor_asset;',
      'CREATE INDEX IF NOT EXISTS i ON t(a); -- DELETE FROM t',
    ].join('\r\n');
    expect(pf.dataChanges(sql)).toEqual([
      'UPDATE sponsor_business',
      'DELETE FROM events',
      'DROP TABLE sponsor_asset',
      'INSERT INTO sponsor_asset_new',
    ]);
  });

  test('statements split over lines or padded with spaces are still found', () => {
    const sql =
      'DELETE\n  FROM   events;\nDROP   TABLE IF EXISTS old_table;\nINSERT OR IGNORE INTO seeds (a) VALUES (1);';
    expect(pf.dataChanges(sql)).toEqual([
      'DELETE FROM events',
      'DROP TABLE old_table',
      'INSERT INTO seeds',
    ]);
  });

  test('a word like UPDATE inside another statement is not a statement of its own', () => {
    const sql = 'CREATE TABLE t (a TEXT REFERENCES p(id) ON UPDATE CASCADE ON DELETE CASCADE);';
    expect(pf.dataChanges(sql)).toEqual([]);
  });

  test('a migration that only adds a column or a table changes no rows', () => {
    expect(
      pf.dataChanges('ALTER TABLE t ADD COLUMN c TEXT;\nCREATE TABLE IF NOT EXISTS n (a TEXT);')
    ).toEqual([]);
  });
});

describe('the written migration plan covers what will be applied', () => {
  const pending = [
    { binding: 'DB', file: '0004_step.sql', sql: 'ALTER TABLE t ADD COLUMN c TEXT;' },
    { binding: 'DB', file: '0005_step.sql', sql: 'DELETE FROM t WHERE a = 1;' },
  ];
  const plan = '| `0004_step.sql` | adds c |\n| `0005_step.sql` | deletes |\n';

  test('no migration lists yet: not checked', () => {
    expect(pf.checkPlanCoverage({ pending: undefined, planText: plan }).status).toBe('todo');
  });

  test('passes when every file to apply is in the plan, and names the ones that change rows', () => {
    const r = pf.checkPlanCoverage({ pending, planText: plan });
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('0005_step.sql (DELETE FROM t)');
    expect(r.detail).not.toContain('0004_step.sql (');
  });

  test('fault: a migration landed after the plan was written', () => {
    const r = pf.checkPlanCoverage({
      pending: [
        ...pending,
        { binding: 'FORMS_DB', file: '0006_new.sql', sql: 'UPDATE t SET a = 1;' },
      ],
      planText: plan,
    });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('0006_new.sql');
    expect(r.detail).toContain('UPDATE t');
  });

  test('fault: the plan file is missing', () => {
    expect(pf.checkPlanCoverage({ pending, planText: undefined }).status).toBe('fail');
  });

  test('nothing to apply needs no plan', () => {
    expect(pf.checkPlanCoverage({ pending: [], planText: undefined }).status).toBe('pass');
  });
});

describe('the staging chain is green for the commit', () => {
  const sha = 'abc1234' + '0'.repeat(33);

  test('no file yet: not checked', () => {
    const r = pf.checkStagingChain({ text: undefined, sha });
    expect(r.status).toBe('todo');
    expect(r.fix).toContain('gh run view');
  });

  test('passes when the run is for this commit on main and T1 to T4 all passed', () => {
    const r = pf.checkStagingChain({ text: RUN(), sha });
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('abc1234');
  });

  test('a short commit id matches the full one', () => {
    expect(pf.checkStagingChain({ text: RUN(), sha: 'abc1234' }).status).toBe('pass');
  });

  test.each([
    'T1 Deploy → Staging',
    'T2 Contract → Staging (Bruno)',
    'T3 E2E Smoke → Staging (Playwright)',
    'T4 Functional → Staging',
  ])('fault: %s did not pass', (name) => {
    const run = JSON.parse(RUN());
    run.jobs.find((j) => j.name === name).conclusion = 'failure';
    const r = pf.checkStagingChain({ text: JSON.stringify(run), sha });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain(name);
  });

  test('a job name whose arrow was re-encoded by the Windows console still matches', () => {
    const mangled = RUN().split('→').join('ΓåÆ');
    expect(mangled).not.toContain('→');
    expect(pf.checkStagingChain({ text: mangled, sha }).status).toBe('pass');
    const failed = JSON.parse(mangled);
    failed.jobs[4].conclusion = 'failure';
    expect(pf.checkStagingChain({ text: JSON.stringify(failed), sha }).status).toBe('fail');
  });

  test('fault: a stage was skipped (skipped is not passed)', () => {
    const run = JSON.parse(RUN());
    run.jobs.find((j) => j.name === 'T4 Functional → Staging').conclusion = 'skipped';
    expect(pf.checkStagingChain({ text: JSON.stringify(run), sha }).status).toBe('fail');
  });

  test('fault: a stage is not in the run at all', () => {
    const run = JSON.parse(RUN());
    run.jobs = run.jobs.filter((j) => j.name !== 'T2 Contract → Staging (Bruno)');
    const r = pf.checkStagingChain({ text: JSON.stringify(run), sha });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('T2 Contract → Staging (Bruno)');
  });

  test('fault: the green run is for another commit', () => {
    const r = pf.checkStagingChain({ text: RUN(), sha: 'fff9999' });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('fff9999');
    expect(r.detail).toContain('abc1234');
  });

  test('fault: the run is from a branch, not main', () => {
    expect(pf.checkStagingChain({ text: RUN({ headBranch: 'ci/thing' }), sha }).status).toBe(
      'fail'
    );
  });

  test('fault: the file is not JSON', () => {
    const r = pf.checkStagingChain({ text: 'HTTP 401: Bad credentials', sha });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('not a CI run');
    expect(r.fix).toContain('gh run view');
  });

  test('fault: no commit id to compare with', () => {
    expect(pf.checkStagingChain({ text: RUN(), sha: '' }).status).toBe('fail');
  });
});

describe('production admin is behind its own Cloudflare Access app', () => {
  const canary = (conclusion) =>
    JSON.stringify({
      conclusion: 'failure',
      jobs: [
        { name: 'Access app routing — staging', conclusion: 'success' },
        { name: 'Access app routing — production', conclusion },
      ],
    });

  test('no file yet: not checked', () => {
    expect(pf.checkAccessApp({ text: undefined }).status).toBe('todo');
  });

  test('passes when the production job of the canary passed', () => {
    expect(pf.checkAccessApp({ text: canary('success') }).status).toBe('pass');
  });

  test('fault: the production job failed', () => {
    const r = pf.checkAccessApp({ text: canary('failure') });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('Access');
  });

  test('fault: the production job is not in the run', () => {
    const run = JSON.stringify({
      jobs: [{ name: 'Access app routing — staging', conclusion: 'success' }],
    });
    expect(pf.checkAccessApp({ text: run }).status).toBe('fail');
  });
});

// ── the report ──────────────────────────────────────────────────────────────

describe('the report', () => {
  const pass = { id: 'a', title: 'A thing', status: 'pass', detail: 'fine' };
  const fail = { id: 'b', title: 'B thing', status: 'fail', detail: 'broken', fix: 'mend it' };
  const todo = {
    id: 'c',
    title: 'C thing',
    status: 'todo',
    detail: 'no file',
    fix: 'make the file',
  };

  test('all passed: ready, exit 0', () => {
    const out = pf.render([pass]);
    expect(out.exitCode).toBe(0);
    expect(out.text).toContain('PASS  A thing: fine');
    expect(out.text).toContain('READY');
    expect(out.text).not.toContain('NOT READY');
  });

  test('one failed: not ready, exit 1, with what to do', () => {
    const out = pf.render([pass, fail]);
    expect(out.exitCode).toBe(1);
    expect(out.text).toContain('FAIL  B thing: broken');
    expect(out.text).toContain('Do: mend it');
    expect(out.text).toContain('NOT READY: 1 failed');
  });

  test('one not checked: not ready, exit 1 (an unchecked item is not a pass)', () => {
    const out = pf.render([pass, todo]);
    expect(out.exitCode).toBe(1);
    expect(out.text).toContain('TODO  C thing: no file');
    expect(out.text).toContain('NOT READY: 0 failed, 1 not checked');
  });

  test('one line per check, with forward slashes only', () => {
    const windowsPath = ['workers', 'oursharedevents', 'wrangler.toml'].join(
      String.fromCharCode(92)
    );
    const out = pf.render([pass, { ...fail, detail: `see ${windowsPath}` }, todo]);
    expect(out.text.split('\n').filter((l) => /^(PASS|FAIL|TODO) {2}/.test(l))).toHaveLength(3);
    expect(out.text).toContain('see workers/oursharedevents/wrangler.toml');
    expect(out.text).not.toContain(String.fromCharCode(92));
  });
});

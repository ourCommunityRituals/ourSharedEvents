/**
 * The migration dry run (OSE-2016): read-only counts taken on staging before a
 * migration is applied there.
 *
 * What these hold:
 *   - the script sends nothing unless every statement is a SELECT;
 *   - "could not read the pending list" is never read as "nothing pending";
 *   - the T1 staging deploy runs it before either apply step;
 *   - neither the script nor the on-demand workflow can name production.
 *
 * Seen red (2026-11-14), each on a planted fault, then restored:
 *   - WRITE_WORDS without DELETE: "refuses a file that writes" fails;
 *   - readOnlyFaults without the SELECT/WITH start check: the same test fails;
 *   - pendingNumbers returning [] for unreadable output: its test fails;
 *   - the dry-run step moved below "Apply D1 migrations (main DB)": the order test fails;
 *   - the dry-run step removed: the order test fails;
 *   - the remote-needs-staging check removed from parseArgs: the production test fails;
 *   - dry-run-0108 given an UPDATE: "every committed dry-run file is read-only" fails.
 */
const { spawnSync } = require('node:child_process');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'migration-dry-run.mjs');
const DRY_RUN_DIR = join(ROOT, 'workers', 'oursharedevents', 'scripts');
const CI = readFileSync(join(ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'), 'utf8');
const DISPATCH = readFileSync(join(ROOT, '.github', 'workflows', 'migration-dry-run.yml'), 'utf8');
const code = (text) =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

let lib;
beforeAll(async () => {
  lib = await import(SCRIPT);
});

describe('migration dry run: the read-only check', () => {
  test('passes plain SELECTs and WITH ... SELECT, and drops comments', () => {
    const sql = `-- a note; with a semicolon
      SELECT COUNT(*) AS n FROM events; /* block; comment */
      WITH x AS (SELECT 1 AS a) SELECT a FROM x;`;
    expect(lib.readOnlyStatements(sql)).toEqual([
      'SELECT COUNT(*) AS n FROM events',
      'WITH x AS (SELECT 1 AS a) SELECT a FROM x',
    ]);
  });

  test('refuses a file that writes, and names the statement', () => {
    const writes = [
      "UPDATE events SET status = 'x'",
      'DELETE FROM events',
      'INSERT INTO events (id) VALUES (1)',
      'DROP TABLE events',
      'ALTER TABLE events ADD COLUMN x TEXT',
      'CREATE TABLE t (a)',
      'PRAGMA foreign_keys = OFF',
      'WITH x AS (SELECT 1) DELETE FROM events',
      'SELECT 1; DELETE FROM events',
      'REPLACE INTO events (id) VALUES (1)',
      'VACUUM',
      // No write word in these two: only the SELECT-or-WITH start check stops them.
      'ANALYZE events',
      'EXPLAIN SELECT 1',
    ];
    for (const sql of writes) {
      expect(() => lib.readOnlyStatements(sql, 'f.sql'), sql).toThrow(
        /not read-only, nothing was sent/
      );
    }
  });

  test('a write word inside a quoted value is data, and pragma_table_info is a read', () => {
    expect(lib.readOnlyFaults("SELECT COUNT(*) FROM events WHERE status = 'delete'")).toEqual([]);
    expect(
      lib.readOnlyFaults("SELECT COUNT(*) FROM pragma_table_info('events') WHERE name = 'x'")
    ).toEqual([]);
  });

  test('refuses an empty file and a semicolon inside a quoted string', () => {
    expect(() => lib.readOnlyStatements('-- only a comment')).toThrow(/holds no statement/);
    expect(() => lib.readOnlyStatements("SELECT 'a;b'")).toThrow(/semicolon/);
  });

  test('every committed dry-run file is read-only and well named', () => {
    const files = readdirSync(DRY_RUN_DIR).filter((n) => n.startsWith('dry-run-'));
    expect(files).toContain('dry-run-0108-attendance-mode.sql');
    for (const name of files) {
      expect(lib.isDryRunFileName(name), name).toBe(true);
      expect(
        lib.readOnlyStatements(readFileSync(join(DRY_RUN_DIR, name), 'utf8'), name).length
      ).toBeGreaterThan(0);
    }
  });
});

describe('migration dry run: which files run', () => {
  test('reads the pending numbers from the wrangler list', () => {
    const out =
      '│ 0107_events_use_sponsors_backfill.sql │\n├──┤\n│ 0108_event_attendance_mode.sql │';
    expect(lib.pendingNumbers(out)).toEqual(['0107', '0108']);
    expect(lib.pendingNumbers('✅ No migrations to apply!')).toEqual([]);
  });

  test('output that says neither is null, never "nothing pending"', () => {
    expect(lib.pendingNumbers('✘ [ERROR] Authentication error [code: 10000]')).toBeNull();
    expect(lib.pendingNumbers('')).toBeNull();
  });

  test('a file belongs to one database, by its prefix', () => {
    expect(lib.dryRunFiles('DB')['0108']).toEqual(['dry-run-0108-attendance-mode.sql']);
    expect(lib.dryRunFiles('FORMS_DB')['0108']).toBeUndefined();
    expect(lib.bindingOfFile('dry-run-forms-0031-x.sql')).toBe('FORMS_DB');
    expect(lib.bindingOfFile('dry-run-0108-attendance-mode.sql')).toBe('DB');
  });

  test('a typed file name cannot be a path', () => {
    for (const bad of [
      '../x.sql',
      'dry-run-0108-a.sql; rm -rf',
      'a/dry-run-0108-a.sql',
      'dry-run-108-a.sql',
    ]) {
      expect(lib.isDryRunFileName(bad), bad).toBe(false);
    }
  });
});

describe('migration dry run: staging only', () => {
  const run = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

  test('a remote run refuses any environment but staging, before calling wrangler', () => {
    for (const args of [
      ['--pending', '--env', 'production', '--remote'],
      ['--pending', '--remote'],
      ['--file', 'dry-run-0108-attendance-mode.sql', '--env', 'production'],
    ]) {
      const r = run(...args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stderr).toMatch(/needs --env staging/);
    }
  });

  test('neither workflow names production for it', () => {
    expect(code(DISPATCH)).not.toMatch(/production/);
    expect(code(DISPATCH)).toMatch(/--env staging --remote/);
    expect(code(DISPATCH)).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(code(DISPATCH)).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(code(DISPATCH)).toMatch(/permissions:\s*\n\s+contents: read/);
    const uses = CI.split('\n').filter(
      (l) => l.includes('migration-dry-run.mjs') && !/^\s*#/.test(l)
    );
    expect(uses.length).toBe(1);
    expect(uses[0]).toMatch(/--pending --env staging --remote/);
  });

  test('the typed file name reaches the script through env, not the command line', () => {
    expect(code(DISPATCH)).toMatch(/DRY_RUN_FILE: \$\{\{ github\.event\.inputs\.file \}\}/);
    expect(code(DISPATCH)).not.toMatch(/run:.*\$\{\{/);
  });
});

describe('migration dry run: T1 runs it before the migrations are applied', () => {
  test('the step sits in the staging deploy job, above both apply steps', () => {
    const job = CI.slice(
      CI.indexOf('\n  deploy-staging:'),
      CI.indexOf('\n  contract-staging-sub:')
    );
    const dry = job.indexOf(
      'node scripts/ci/migration-dry-run.mjs --pending --env staging --remote'
    );
    const main = job.indexOf('npx wrangler d1 migrations apply DB --env staging --remote');
    const forms = job.indexOf('npx wrangler d1 migrations apply FORMS_DB --env staging --remote');
    expect(dry).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(main);
    expect(dry).toBeLessThan(forms);
  });

  test('the step can stop the job: no continue-on-error, no "|| true"', () => {
    const at = CI.indexOf("- name: 'Dry run: pending migrations");
    const step = CI.slice(at, CI.indexOf('- name: Apply D1 migrations (main DB)'));
    expect(step).not.toMatch(/continue-on-error/);
    expect(step).not.toMatch(/\|\|\s*true/);
  });
});

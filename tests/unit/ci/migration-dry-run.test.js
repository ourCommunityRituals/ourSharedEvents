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
 *
 * The output rules and the production step (OSE-2085, ADR-037). Seen red
 * (2026-11-15) on seventeen planted faults, one at a time, then restored: the
 * forms database not strict; production not strict; the floor set to 4; the
 * GROUP BY check off; the UNION check off; MIN and MAX allowed; anything
 * allowed after COUNT(); the comma-join check off; no floor on print; no
 * one-row check; a label let through under strict; any text printed under
 * plain; a non-count number allowed; the production step moved below the
 * apply; the production step removed; production taking --file; the 0108 file
 * given its GROUP BY back.
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

describe('migration dry run: the printed table', () => {
  // Seen red (2026-11-14): with the backslash escape removed the first case fails.
  test('a backslash, a pipe or a line break in a value cannot break the table', () => {
    const md = lib.toMarkdown([{ 'a|b': 'x\\|y', n: 'one\ntwo' }]);
    const rows = md.split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe('| a\\|b | n |');
    expect(rows[2]).toBe('| x\\\\\\|y | one two |');
  });

  test('no rows and NULL are said in words', () => {
    expect(lib.toMarkdown([])).toBe('_no rows_');
    expect(lib.toMarkdown([{ n: null }])).toContain('| NULL |');
  });
});

describe('migration dry run: staging only', () => {
  const run = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

  test('a remote run needs staging, or production with --pending and no file', () => {
    const refused = [
      ['--pending', '--remote'],
      ['--pending', '--env', 'preview', '--remote'],
      ['--file', 'dry-run-0108-attendance-mode.sql', '--env', 'production'],
      ['--file', 'dry-run-0108-attendance-mode.sql', '--env', 'production', '--remote'],
      ['--pending', '--env', 'production', '--local'],
    ];
    for (const args of refused) {
      expect(() => lib.parseArgs(args), args.join(' ')).toThrow(
        /needs --env staging|cannot name production/
      );
    }
    // Refused by the process too, before wrangler is called.
    const r = run('--file', 'dry-run-0108-attendance-mode.sql', '--env', 'production', '--remote');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no on-demand production run/);
    expect(lib.parseArgs(['--pending', '--env', 'production', '--remote']).env).toBe('production');
    expect(lib.parseArgs(['--pending', '--env', 'staging', '--remote']).env).toBe('staging');
    expect(lib.parseArgs(['--file', 'x', '--env', 'staging']).file).toBe('x');
  });

  test('the on-demand workflow cannot name production, and CI uses the script twice', () => {
    expect(code(DISPATCH)).not.toMatch(/production/);
    expect(code(DISPATCH)).toMatch(/--env staging --remote/);
    expect(code(DISPATCH)).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(code(DISPATCH)).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(code(DISPATCH)).toMatch(/permissions:\s*\n\s+contents: read/);
    const uses = CI.split('\n')
      .filter((l) => l.includes('migration-dry-run.mjs') && !/^\s*#/.test(l))
      .map((l) => l.trim());
    expect(uses).toEqual([
      'run: node scripts/ci/migration-dry-run.mjs --pending --env staging --remote',
      'run: node scripts/ci/migration-dry-run.mjs --pending --env production --remote',
    ]);
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

describe('migration dry run: production runs it before its migrations are applied (OSE-2085)', () => {
  const job = CI.slice(CI.indexOf('\n  deploy-production:'), CI.indexOf('\n  smoke-production:'));

  test('the step sits in the production deploy job, above both apply steps', () => {
    const dry = job.indexOf(
      'node scripts/ci/migration-dry-run.mjs --pending --env production --remote'
    );
    const main = job.indexOf('npx wrangler d1 migrations apply DB --env production --remote');
    const forms = job.indexOf(
      'npx wrangler d1 migrations apply FORMS_DB --env production --remote'
    );
    const deploy = job.indexOf('npx wrangler deploy --env production');
    expect(dry).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(main);
    expect(dry).toBeLessThan(forms);
    expect(dry).toBeLessThan(deploy);
  });

  test('the step can stop the job', () => {
    const at = job.indexOf("- name: 'Dry run: pending migrations on production");
    const step = job.slice(at, job.indexOf('- name: Apply D1 migrations (main DB)'));
    expect(at).toBeGreaterThan(-1);
    expect(step).not.toMatch(/continue-on-error/);
    expect(step).not.toMatch(/\|\|\s*true/);
    expect(step).not.toMatch(/^\s+if:/m);
  });
});

describe('migration dry run: what it may print (ADR-037)', () => {
  test('strict on production and on the forms database, plain on the main database elsewhere', () => {
    expect(lib.outputRule('DB', 'production')).toBe('strict');
    expect(lib.outputRule('FORMS_DB', 'production')).toBe('strict');
    expect(lib.outputRule('FORMS_DB', 'staging')).toBe('strict');
    expect(lib.outputRule('FORMS_DB', null)).toBe('strict');
    expect(lib.outputRule('DB', 'staging')).toBe('plain');
    expect(lib.outputRule('DB', null)).toBe('plain');
  });

  test("the floor is the worker's floor", () => {
    const src = readFileSync(
      join(ROOT, 'workers', 'oursharedevents', 'src', 'lib', 'shared-report.ts'),
      'utf8'
    );
    const m = src.match(/export const CORRIDOR_MAP_MIN_COUNT = (\d+);/);
    expect(m).not.toBeNull();
    expect(lib.COUNT_FLOOR).toBe(Number(m[1]));
    expect(lib.WITHHELD).toBe(`Fewer than ${m[1]}`);
  });

  test('a strict statement is one row of COUNTs, and nothing else', () => {
    for (const ok of [
      'SELECT COUNT(*) AS n FROM registrations',
      "SELECT COUNT(*) AS n, COUNT(DISTINCT event_id) m FROM registrations WHERE status = 'a'",
      'SELECT COUNT(*) FROM (SELECT email FROM registrations)',
    ]) {
      expect(lib.strictFaults(ok), ok).toEqual([]);
    }
    for (const bad of [
      'SELECT email FROM registrations',
      'SELECT status, COUNT(*) FROM events GROUP BY status',
      'SELECT COUNT(*) FROM events GROUP BY status',
      'SELECT MIN(email) FROM registrations',
      'SELECT MAX(created_at) AS latest FROM registrations',
      'SELECT COUNT(*) + 0 FROM registrations',
      'SELECT COUNT(*) OVER (PARTITION BY email) FROM registrations',
      'SELECT (SELECT email FROM registrations LIMIT 1) FROM events',
      'SELECT COUNT(*), email FROM registrations',
      'SELECT COUNT(*) FROM a UNION SELECT COUNT(*) FROM b',
      'WITH a AS (SELECT email FROM registrations) SELECT COUNT(*) FROM a',
      'SELECT * FROM registrations',
    ]) {
      expect(lib.strictFaults(bad).length, bad).toBeGreaterThan(0);
    }
    expect(() => lib.assertRule(['SELECT email FROM registrations'], 'strict', 'f.sql')).toThrow(
      /may print more than counts, nothing was sent/
    );
    expect(() =>
      lib.assertRule(['SELECT email FROM registrations'], 'plain', 'f.sql')
    ).not.toThrow();
  });

  test('a schema fact is exact, and a comma join is not a schema fact', () => {
    const schema =
      "SELECT COUNT(*) AS there FROM pragma_table_info('events') WHERE name IN ('a', 'b')";
    expect(lib.isSchemaOnly(schema)).toBe(true);
    expect(lib.strictFaults('SELECT name FROM sqlite_master')).toEqual([]);
    expect(lib.printableRows([{ there: 0 }], 'strict', schema)).toEqual([{ there: 0 }]);
    expect(lib.isSchemaOnly('SELECT name FROM sqlite_master, registrations')).toBe(false);
    expect(lib.isSchemaOnly('SELECT name FROM sqlite_master JOIN registrations r ON 1')).toBe(
      false
    );
    expect(
      lib.isSchemaOnly('SELECT (SELECT email FROM registrations LIMIT 1) FROM sqlite_master')
    ).toBe(false);
    expect(lib.isSchemaOnly('SELECT COUNT(*) FROM events')).toBe(false);
  });

  test('under the strict rule a count under the floor reads in words, zero too', () => {
    const q = 'SELECT COUNT(*) a, COUNT(*) b, COUNT(*) c, COUNT(*) d FROM registrations';
    expect(lib.printableRows([{ a: 0, b: 4, c: 5, d: 495 }], 'strict', q)).toEqual([
      { a: 'Fewer than 5', b: 'Fewer than 5', c: 5, d: 495 },
    ]);
    // The same numbers are exact on staging's main database.
    expect(lib.printableRows([{ a: 0, b: 4 }], 'plain', q)).toEqual([{ a: 0, b: 4 }]);
  });

  test('a strict answer that is not one row of counts stops, and the value is not in the message', () => {
    const q = 'SELECT COUNT(*) n FROM registrations';
    const secret = 'someone@example.org';
    const cases = [
      [[{ n: secret }], /column n holds text/],
      [[{ n: 'active' }], /column n holds text/],
      [[{ n: 1.5 }], /not a count/],
      [[{ n: -1 }], /not a count/],
      [[{ n: null }], /empty, not a count/],
      [[{ n: 7 }, { n: 8 }], /returned 2 rows/],
      [[], /returned 0 rows/],
    ];
    for (const [rows, why] of cases) {
      let message = '';
      try {
        lib.printableRows(rows, 'strict', q);
      } catch (e) {
        message = e.message;
      }
      expect(message, JSON.stringify(rows)).toMatch(why);
      expect(message).not.toContain(secret);
    }
  });

  test('under the plain rule a text cell is a short label or it stops', () => {
    const q = 'SELECT status, COUNT(*) n FROM events GROUP BY status';
    expect(lib.printableRows([{ status: 'active', n: 3 }], 'plain', q)).toEqual([
      { status: 'active', n: 3 },
    ]);
    for (const text of ['Jo Smith', 'someone@example.org', '555-0100', 'A', '', 'x'.repeat(40)]) {
      expect(() => lib.printableRows([{ status: text, n: 3 }], 'plain', q), text).toThrow(
        /not a short label/
      );
    }
  });

  test('every committed dry-run file fits the strict rule, so none can stop a production deploy', () => {
    const files = readdirSync(DRY_RUN_DIR).filter((n) => n.startsWith('dry-run-'));
    for (const name of files) {
      const statements = lib.readOnlyStatements(
        readFileSync(join(DRY_RUN_DIR, name), 'utf8'),
        name
      );
      expect(() => lib.assertRule(statements, 'strict', name), name).not.toThrow();
    }
  });
});

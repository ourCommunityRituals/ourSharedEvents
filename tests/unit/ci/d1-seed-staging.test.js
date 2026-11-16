/**
 * Staging seed steps wait out another D1 import (run 38162352541).
 * Seen red: with the old single 5 s retry (BUSY_WAITS_S = [5]) the
 * "busy for three tries" case fails.
 *
 * OSE-2090: a seed is sent with `--command`, never `--file`. Against a remote
 * database `--file` is an import, and the database answers no queries while it
 * runs; the other T2 leg's reads got 503s (run 43802459749 and five more).
 * Seen red: with wranglerArgs sending `--file`, the first OSE-2090 case fails.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '../../..');

let applyWithRetry;
let BUSY_WAITS_S;
let MAX_SQL_BYTES;
let sqlForFile;
let stripSqlComments;
let wranglerArgs;

beforeAll(async () => {
  ({ applyWithRetry, BUSY_WAITS_S, MAX_SQL_BYTES, sqlForFile, stripSqlComments, wranglerArgs } =
    await import('../../../scripts/ci/d1-seed-staging.mjs'));
});

/** Every fixture a workflow seeds through the script, as repo paths. */
function seededFixtures() {
  const wf = readFileSync(join(ROOT, '.github/workflows/oursharedevents-ci.yml'), 'utf8');
  const files = new Set();
  for (const m of wf.matchAll(/d1-seed-staging\.mjs\s+\w+((?:[ \t]+\S+\.sql)+)/g)) {
    for (const f of m[1].trim().split(/\s+/)) files.add(f.replace(/^(?:\.\.\/)+/, ''));
  }
  return [...files];
}

const BUSY_OUT =
  '✘ [ERROR] Currently processing a long-running import. Cannot start another import until that completes or times out.';

function harness(results) {
  const calls = [];
  const slept = [];
  const lines = [];
  return {
    calls,
    slept,
    lines,
    opts: {
      db: 'DB',
      file: 'fixture.sql',
      run: (db, file) => {
        calls.push([db, file]);
        const r = results[calls.length - 1];
        return r === 'ok' ? { ok: true, output: '' } : { ok: false, output: r };
      },
      sleep: async (s) => {
        slept.push(s);
      },
      log: (l) => lines.push(l),
    },
  };
}

describe('d1-seed-staging', () => {
  test('applies on the first try without waiting', async () => {
    const h = harness(['ok']);
    expect(await applyWithRetry(h.opts)).toBe(true);
    expect(h.calls).toEqual([['DB', 'fixture.sql']]);
    expect(h.slept).toEqual([]);
  });

  test('busy for three tries, then applied: waits 10, 20, 30 s', async () => {
    const h = harness([BUSY_OUT, BUSY_OUT, BUSY_OUT, 'ok']);
    expect(await applyWithRetry(h.opts)).toBe(true);
    expect(h.slept).toEqual([10, 20, 30]);
    expect(h.lines.every((l) => l.startsWith('::warning::'))).toBe(true);
  });

  test('busy past every wait: fails by name, after 150 s in all', async () => {
    const h = harness(Array(BUSY_WAITS_S.length + 1).fill(BUSY_OUT));
    expect(await applyWithRetry(h.opts)).toBe(false);
    expect(h.slept.reduce((a, b) => a + b, 0)).toBe(150);
    expect(h.lines.at(-1)).toMatch(/^::error::DB fixture\.sql: not applied/);
  });

  test('any other error is retried once, after 5 s', async () => {
    const h = harness(['boom', 'boom']);
    expect(await applyWithRetry(h.opts)).toBe(false);
    expect(h.slept).toEqual([5]);
    expect(h.calls).toHaveLength(2);
  });

  test('every staging seed in the CI workflow goes through the script', () => {
    const wf = readFileSync(
      join(__dirname, '../../../.github/workflows/oursharedevents-ci.yml'),
      'utf8'
    );
    const direct = wf
      .split('\n')
      .filter((l) => /wrangler d1 execute\b.*--remote/.test(l) && !/^\s*#/.test(l))
      .filter((l) => !/--command|--json/.test(l));
    expect(direct, 'use scripts/ci/d1-seed-staging.mjs for --file seeds').toEqual([]);
    expect(wf).toMatch(/d1-seed-staging\.mjs DB/);
  });

  test('OSE-2090: a seed goes to the query endpoint (--command), never the import (--file)', () => {
    const args = wranglerArgs('DB', 'UPDATE events SET is_published = 0;');
    expect(args).toContain('--command');
    expect(args).not.toContain('--file');
    expect(args).toEqual(expect.arrayContaining(['--remote', '--env', 'staging']));
    expect(args.at(-1)).toBe('UPDATE events SET is_published = 0;');
    // The runner builds its arguments only through wranglerArgs.
    const src = readFileSync(join(ROOT, 'scripts/ci/d1-seed-staging.mjs'), 'utf8');
    expect(src).not.toMatch(/['"]--file['"]/);
    expect(src).not.toMatch(/shell:\s*(true|process)/);
  });

  test('OSE-2090: comments go, quoted text stays exactly as written', () => {
    const sql = [
      '-- a header comment',
      "INSERT INTO t (a, b) VALUES ('x -- not a comment', 'it''s; fine'); -- trailing",
      '/* a block',
      '   comment */ UPDATE t SET "col--name" = `v/*w*/` WHERE [id--x] = 1;',
      '',
    ].join('\n');
    expect(stripSqlComments(sql)).toBe(
      [
        "INSERT INTO t (a, b) VALUES ('x -- not a comment', 'it''s; fine');",
        '  UPDATE t SET "col--name" = `v/*w*/` WHERE [id--x] = 1;',
      ].join('\n')
    );
    expect(() => stripSqlComments("SELECT 'open")).toThrow(/unclosed quote/);
    expect(() => stripSqlComments('SELECT 1 /* open')).toThrow(/unclosed/);
  });

  test('OSE-2090: a file too big for one D1 query, or with no SQL, is refused before sending', () => {
    const big = `INSERT INTO t VALUES ('${'x'.repeat(MAX_SQL_BYTES)}');`;
    expect(sqlForFile(big)).toEqual({ ok: false, reason: expect.stringMatching(/over 90000/) });
    expect(sqlForFile('-- only a comment\n')).toEqual({ ok: false, reason: 'holds no SQL' });
    expect(MAX_SQL_BYTES).toBeLessThan(100_000); // D1's limit on one SQL text
  });

  test('OSE-2090: a fixture that could print rows to the public log is refused', () => {
    expect(sqlForFile("UPDATE t SET a = 'SELECT; x' WHERE id = 1;")).toMatchObject({ ok: true });
    expect(sqlForFile('UPDATE t SET a = 1;\nSELECT * FROM t;')).toEqual({
      ok: false,
      reason: expect.stringMatching(/has a SELECT statement/),
    });
    expect(sqlForFile('PRAGMA table_info(t);')).toMatchObject({ ok: false });
    expect(sqlForFile("INSERT INTO t (a) VALUES ('x') RETURNING id;")).toEqual({
      ok: false,
      reason: expect.stringMatching(/RETURNING/),
    });
    // The words inside quoted text do not count.
    expect(sqlForFile("INSERT INTO t (a) VALUES ('returning; select 1');")).toMatchObject({
      ok: true,
    });
  });

  test('OSE-2090: every fixture CI seeds can be sent as one query', () => {
    const files = seededFixtures();
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const r = sqlForFile(readFileSync(join(ROOT, f), 'utf8'));
      expect(r, f).toMatchObject({ ok: true });
      expect(r.sql, f).not.toMatch(/^\s*--/m);
    }
  });
});

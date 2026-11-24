/**
 * OSE-2214 — seed files applied to staging D1 use no compound SELECT.
 *
 * Staging D1 refused a 12-term UNION ALL chain in the depth-gate seed with
 * "too many terms in compound SELECT: SQLITE_ERROR [code: 7500]" (run
 * 45311429088, step T4f-seed), which skipped the depth gate and the T4 steps
 * after it. A local SQLite accepts the same file, so only this check catches it
 * before staging. Every file a workflow hands to scripts/ci/d1-seed-staging.mjs
 * is read, comments are stripped, and no statement may hold UNION, INTERSECT
 * or EXCEPT. Seed one row per INSERT instead.
 *
 * @born-red OSE-2214 | method: run against corridor-baseline-smoke.sql as it
 * stood at 723606a (12-term UNION ALL); the test failed naming that file, then
 * passed on the one-INSERT-per-scan rewrite | date: 2026-11-24
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const WORKER = path.join(ROOT, 'workers/oursharedevents');

function seededFiles() {
  const files = new Set();
  for (const f of fs.readdirSync(WORKFLOWS)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const text = fs.readFileSync(path.join(WORKFLOWS, f), 'utf8');
    const re = /d1-seed-staging\.mjs\s+\S+\s+(\S+\.sql)/g;
    let m;
    while ((m = re.exec(text))) {
      files.add(path.relative(ROOT, path.resolve(WORKER, m[1])));
    }
  }
  return [...files].sort();
}

function compoundStatements(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /\b(UNION|INTERSECT|EXCEPT)\b/i.test(s));
}

describe('D1 seed files (OSE-2214): no compound SELECT', () => {
  const files = seededFiles();

  test('the workflows seed at least the depth-gate fixture', () => {
    expect(files).toContain('tests/ui/smoke/fixtures/corridor-baseline-smoke.sql');
    expect(files.length).toBeGreaterThan(10);
  });

  test.each(files)('%s has no UNION, INTERSECT or EXCEPT', (file) => {
    const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(compoundStatements(sql)).toEqual([]);
  });

  test('the check sees a compound SELECT when one is there', () => {
    expect(compoundStatements('INSERT INTO t SELECT 1 UNION ALL SELECT 2;')).toHaveLength(1);
    expect(compoundStatements('-- a UNION in a comment\nINSERT INTO t VALUES (1);')).toEqual([]);
  });
});

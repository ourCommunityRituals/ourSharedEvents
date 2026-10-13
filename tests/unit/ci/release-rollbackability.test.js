/**
 * Release rollback-ability (scripts/ci/release-rollbackability.mjs), CCR A1.
 * Each rule has the fault that must turn it red, and the real production
 * migrations that the first deploy carries are the case that matters.
 */
const fs = require('node:fs');
const path = require('node:path');

let rb;

beforeAll(async () => {
  rb = await import('../../../scripts/ci/release-rollbackability.mjs');
});

const MIG = path.join(__dirname, '../../../workers/oursharedevents/migrations');
const readReal = (name) => {
  const f = path.join(MIG, name);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

describe('hazardsOf', () => {
  test.each([
    ['DROP TABLE x;', 'removes a table'],
    ['ALTER TABLE t DROP COLUMN c;', 'removes a column'],
    ['ALTER TABLE t RENAME COLUMN a TO b;', 'renames a column'],
    ['ALTER TABLE t RENAME TO u;', 'renames a table'],
  ])('%s', (sql, what) => {
    expect(rb.hazardsOf(sql)).toEqual([what]);
  });

  test('additive changes are not hazards', () => {
    expect(
      rb.hazardsOf('ALTER TABLE t ADD COLUMN c TEXT; CREATE INDEX i ON t(c); DROP INDEX j;')
    ).toEqual([]);
  });

  test('words in a comment are not statements', () => {
    expect(
      rb.hazardsOf(
        '-- we will DROP TABLE x later and RENAME COLUMN a TO b\nCREATE TABLE y (id TEXT);'
      )
    ).toEqual([]);
  });
});

describe('namesIn', () => {
  test('finds migration names in wrangler-style output, once each, in order', () => {
    const text = '┌──┐\n│ 0102_rename_a.sql │\n│ 0101_b.sql │\n0102_rename_a.sql again';
    expect(rb.namesIn(text)).toEqual(['0101_b.sql', '0102_rename_a.sql']);
  });

  test('no names: nothing to apply', () => {
    expect(rb.namesIn('✔ No migrations to apply!')).toEqual([]);
  });
});

describe('assess and render', () => {
  test('nothing to apply is rollback-able and says why', () => {
    const r = rb.assess([], () => null);
    expect(r.rollbackable).toBe(true);
    expect(rb.render('DB', r)).toContain('No unapplied migrations');
  });

  test('an additive release is rollback-able', () => {
    const r = rb.assess(['0001_a.sql'], () => 'ALTER TABLE t ADD COLUMN c TEXT;');
    expect(r.rollbackable).toBe(true);
  });

  test('a renaming release is not, and the file is named', () => {
    const r = rb.assess(['0103_x.sql'], () => 'ALTER TABLE a RENAME COLUMN b TO c;');
    expect(r.rollbackable).toBe(false);
    expect(rb.render('DB', r)).toContain('NOT ROLL-BACK-ABLE');
    expect(rb.render('DB', r)).toContain('0103_x.sql');
  });

  test('a file it cannot read counts as not roll-back-able', () => {
    const r = rb.assess(['9999_missing.sql'], () => null);
    expect(r.rollbackable).toBe(false);
    expect(r.unreadable).toEqual(['9999_missing.sql']);
  });
});

describe('the first production deploy, read from the real migrations', () => {
  const pending = fs
    .readdirSync(MIG)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && parseInt(f.slice(0, 4), 10) >= 78)
    .sort();

  test('0078 to the latest is not roll-back-able, and the known culprits are named', () => {
    const r = rb.assess(pending, readReal);
    expect(r.rollbackable).toBe(false);
    const named = r.findings.map((f) => f.name.slice(0, 4));
    // 0098 drops subscribers; 0102 rebuilds sponsor_impressions; 0103 renames visit_count.
    expect(named).toEqual(expect.arrayContaining(['0098', '0102', '0103']));
  });

  test('a release that is only the last two additive migrations would be rollback-able', () => {
    const additive = pending.filter((f) => ['0099', '0100', '0101'].includes(f.slice(0, 4)));
    const r = rb.assess(additive, readReal);
    // 0099 adds a column; 0100 and 0101 only change rows and add an index.
    expect(r.rollbackable).toBe(true);
  });
});

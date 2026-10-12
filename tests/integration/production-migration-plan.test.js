/**
 * The production migration plan says what the migration files say.
 *
 * docs/runbooks/PRODUCTION-MIGRATION-PLAN.md is read by the founder before the
 * first production deploy. Its two claims that matter most are "this is every
 * migration production still needs" and "these are the ones that write or
 * remove rows". Both are derived here from the SQL, so the document cannot say
 * a migration is harmless when its file has an UPDATE, DELETE or DROP in it.
 *
 * The range the plan covers is the one it declares ("Covers: main … forms …").
 * A migration added later is caught at deploy time by the preflight ("not in
 * the plan"), not here.
 */

const { existsSync, readFileSync, readdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..');
const WORKER = join(ROOT, 'workers', 'oursharedevents');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let pf;
let health;
let plan;
let range;

const inRange = (dir, from, to) =>
  readdirSync(join(WORKER, dir))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => parseInt(f.slice(0, 4), 10) >= from && parseInt(f.slice(0, 4), 10) <= to)
    .sort()
    .map((file) => ({ dir, file, sql: readFileSync(join(WORKER, dir, file), 'utf8') }));

beforeAll(async () => {
  pf = await import('../../scripts/prod-preflight.mjs');
  health = await import('../../scripts/ci/post-deploy-health.mjs');
  plan = read(pf.PLAN_PATH);
  const m = /^Covers: main (\d{4})–(\d{4}), forms (\d{4})–(\d{4})\.$/m.exec(
    plan.replace(/\r/g, '')
  );
  range = m && {
    main: inRange('migrations', Number(m[1]), Number(m[2])),
    forms: inRange('migrations-forms', Number(m[3]), Number(m[4])),
  };
});

describe('the production migration plan matches the migration files', () => {
  test('it declares the range it covers, and the range holds files', () => {
    expect(range).toBeTruthy();
    expect(range.main.length).toBeGreaterThan(0);
    expect(range.forms.length).toBeGreaterThan(0);
  });

  test('the range is 0078–0101 (24 files) and 0015–0018 (4 files), as its first table says', () => {
    expect(range.main.map((m) => m.file.slice(0, 4))).toEqual(
      Array.from({ length: 24 }, (_, i) => String(78 + i).padStart(4, '0'))
    );
    expect(range.forms.map((m) => m.file.slice(0, 4))).toEqual(['0015', '0016', '0017', '0018']);
    expect(plan).toMatch(/\| Main \(`ocr-db-production`\)\s+\| 77\s+\| 101\s+\| 24\s+\|/);
    expect(plan).toMatch(
      /\| Forms \(`ocr-forms-db-production`\)\s+\| 14 \(see note\)\s+\| 18\s+\| 4\s+\|/
    );
  });

  test('every migration in the range has exactly one table row, and its Rows column is what the SQL says', () => {
    for (const m of [...range.main, ...range.forms]) {
      const rows = plan.split(/\r?\n/).filter((l) => l.startsWith(`| \`${m.file}\``));
      expect(rows, m.file).toHaveLength(1);
      const cells = rows[0].split('|').map((c) => c.trim());
      const says = cells[cells.length - 2];
      expect(says, `${m.file}: ${pf.dataChanges(m.sql).join(', ') || 'no row changes'}`).toBe(
        pf.dataChanges(m.sql).length ? 'Yes' : 'No'
      );
    }
  });

  test('the "write or remove rows" section is exactly the migrations whose SQL does that', () => {
    const derived = [...range.main, ...range.forms]
      .filter((m) => pf.dataChanges(m.sql).length)
      .map((m) => m.file);
    const headed = [...plan.matchAll(/^### `([^`]+)`/gm)].map((h) => h[1]);
    expect(headed.sort()).toEqual(derived.sort());
    expect(plan).toContain(
      `${['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven'][derived.length]} files.`
    );
  });

  test('each of those sections names every table its statements touch', () => {
    const sections = plan.split(/^### /m).slice(1);
    for (const m of [...range.main, ...range.forms]) {
      const changes = pf.dataChanges(m.sql);
      if (!changes.length) continue;
      const body = sections.find((s) => s.startsWith(`\`${m.file}\``));
      expect(body, m.file).toBeTruthy();
      for (const change of changes) {
        const table = change.split(' ').pop();
        expect(body, `${m.file}: ${change}`).toContain(table);
      }
    }
  });

  test('the migrations known to write or remove rows are found by the detector', () => {
    // Read by hand on 2026-10-07. If the detector stops seeing one, every test above passes on less.
    const found = (list, n) => pf.dataChanges(list.find((m) => m.file.startsWith(n)).sql);
    expect(found(range.main, '0081')).toEqual([
      'UPDATE sponsor_business',
      'INSERT INTO sponsor_asset_new',
      'DROP TABLE sponsor_asset',
    ]);
    expect(found(range.main, '0082')).toEqual(['UPDATE poster_deployments']);
    expect(found(range.main, '0086')).toEqual(['DELETE FROM events']);
    expect(found(range.main, '0088')).toEqual(Array(5).fill('UPDATE admin_audit_log'));
    expect(found(range.main, '0089')).toEqual([
      'UPDATE scan_node_returns',
      'UPDATE scan_aggregates',
    ]);
    expect(found(range.main, '0095')).toEqual(['UPDATE scan_node_returns']);
    expect(found(range.main, '0098')).toEqual(['DROP TABLE subscribers']);
    expect(found(range.main, '0101')).toEqual(['DELETE FROM scan_node_returns']);
    expect(found(range.main, '0100')).toEqual([
      'UPDATE scan_placement_events',
      'UPDATE scan_node_returns',
      'UPDATE scan_placement_events',
      'UPDATE scan_node_returns',
    ]);
    expect(found(range.forms, '0016')).toEqual([
      'UPDATE form_registrations',
      'UPDATE checkin_counts',
      'UPDATE form_surveys',
      'UPDATE email_signups',
    ]);
  });

  test('it tells the reader not to apply by hand, and to run the preflight first', () => {
    expect(plan).toContain('You do not apply these by hand.');
    expect(plan).toContain('node scripts/prod-preflight.mjs');
  });
});

describe('the deployment runbook points at the preflight and the plan, once', () => {
  let runbook;
  beforeAll(() => {
    runbook = read('docs/runbooks/RUNBOOK-DEPLOYMENT.md').replace(/\r/g, '');
  });

  test('there is one "Production preflight" section, with the command and both files', () => {
    const headings = runbook.match(/^## Production preflight.*$/gm) || [];
    expect(headings).toHaveLength(1);
    const section = runbook.split(headings[0])[1].split(/^## /m)[0];
    expect(section).toContain('node scripts/prod-preflight.mjs');
    expect(section).toContain('PRODUCTION-MIGRATION-PLAN.md');
    expect(section).toContain(`mkdir ${pf.INPUT_DIR}`);
    for (const file of Object.values(pf.INPUT_FILES)) {
      expect(section, file).toContain(`${pf.INPUT_DIR}/${file}`);
    }
  });

  test('the files it points at exist', () => {
    for (const rel of [
      'scripts/prod-preflight.mjs',
      pf.PLAN_PATH,
      health.ROLLBACK_RUNBOOK,
      'scripts/ci/post-deploy-health.mjs',
    ]) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true);
    }
  });

  test('the numbers it gives for the health gate are the script’s thresholds', () => {
    const t = health.THRESHOLDS;
    expect(runbook).toContain(`every ${t.SECONDS_BETWEEN_READINGS} seconds`);
    expect(t.ROLL_BACK_AFTER_BAD_IN_A_ROW).toBe(3);
    expect(runbook).toContain('three bad readings in a row');
    expect(t.MAX_READINGS * t.SECONDS_BETWEEN_READINGS).toBe(120);
    expect(runbook).toContain('did not settle in two minutes');
  });
});

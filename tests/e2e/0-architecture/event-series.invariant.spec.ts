/**
 * INVARIANT: an event series groups one brand's events, and holds nothing about
 * a person (OSE ADR-028; brain invariants 1, 7 and 9).
 *
 * The behaviour is tested in workers/oursharedevents/tests/event-series.spec.ts
 * and public-event-series.spec.ts. Those specs test the writers that exist
 * today. This gate reads source text, so it also catches a writer added later
 * that skips the rules:
 *
 *   1. Every statement under src/ that writes `events.series_id` binds a brand
 *      in the same statement, and sets no other column.
 *   2. `event_series` is written in two files only: the series handler and the
 *      nightly detector.
 *   3. The detector writes `pending` and `weekly`, and nothing else. A
 *      suggestion is a prompt, never a promotion.
 *   4. The series source files read no people table and never touch FORMS_DB.
 *   5. `event_series` has only the reviewed columns, read from the migrations,
 *      and none is person-shaped.
 *   6. The public series reader shows only a `confirmed` series of the event's
 *      own brand, and exactly five fields.
 *
 * WHAT THIS IS NOT. It reads SQL written as a literal in one template string.
 * A statement built from concatenated strings or a variable SET list passes
 * unread; rule 2 is what keeps such a writer out of other files.
 *
 * STRUCTURAL (node:fs, no deployed worker): listed in the T0 "Architecture:
 * structural invariants" step (tests/integration/infra-consistency.test.js
 * enforces the listing).
 *
 * @born-red OSE-2020 | method: each rule was seen red on a planted fault: a
 * second `UPDATE events SET series_id` with no brand in handlers/events.ts (1);
 * `start_date` added to the attach statement (1); an INSERT INTO event_series in
 * handlers/events.ts (2); the detector writing 'confirmed' (3); `FORMS_DB` and
 * `form_registrations` named in the handler (4); a migration adding
 * `anon_id_hash` to event_series (5); the `confirmed` predicate and then the
 * brand predicate removed from lib/public-series.ts, and a sixth public field (6).
 * date: 2026-11-13
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER = join(REPO_ROOT, 'workers', 'oursharedevents');
const SRC = join(WORKER, 'src');
const MIGRATIONS = join(WORKER, 'migrations');

const HANDLER = 'handlers/event-series.ts';
const DETECTOR = 'lib/shared-report.ts';
const SERIES_FILES = [HANDLER, 'lib/event-series.ts', 'lib/public-series.ts'];

/** The reviewed columns of event_series. Adding one here is a decision. */
const REVIEWED_COLUMNS = [
  'id',
  'venue_id',
  'series_name',
  'cadence',
  'day_of_week',
  'hour_of_day',
  'active_from',
  'active_until',
  'state',
  'detected_at',
  'confirmed_at',
  'rejected_reason',
  'created_at',
  'updated_at',
].sort();

const PERSON_SHAPED =
  /(anon|agent|email|phone|ip_|_ip|user|session|device|fingerprint|attendee|registrant|person|lat$|lon$)/i;

const PEOPLE_TABLES = [
  'form_registrations',
  'form_checkins',
  'form_surveys',
  'form_email_signups',
  'anon_id_returns',
  'scan_events',
  'scan_placement_events',
  'email_subscribers',
];

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Source with comments removed, so a rule named in a comment is not a hit. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const sources = tsFilesUnder(SRC).map((path) => ({
  file: relative(SRC, path).replace(/\\/g, '/'),
  text: code(path),
}));
const source = (file: string): string => {
  const hit = sources.find((s) => s.file === file);
  if (!hit) throw new Error(`${file} not found under src/`);
  return hit.text;
};

/** Each template-literal SQL statement in `text` that starts with `head`. */
function statements(text: string, head: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`]*)`/g)) {
    if (head.test(m[1])) out.push(m[1].replace(/\s+/g, ' ').trim());
  }
  return out;
}

test.describe('event series: one brand, no person (OSE ADR-028)', () => {
  test('the scan sees the code it is about (not vacuous)', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(statements(source(HANDLER), /^\s*UPDATE events SET/i).length).toBeGreaterThanOrEqual(2);
    expect(statements(source(DETECTOR), /^\s*INSERT INTO event_series/i)).toHaveLength(1);
  });

  test('rule 1: every write of events.series_id binds a brand and sets nothing else', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const { file, text } of sources) {
      for (const sql of statements(text, /^\s*UPDATE events SET/i)) {
        const set = sql.slice(sql.search(/SET/i) + 3, sql.search(/WHERE/i));
        if (!/\bseries_id\s*=/.test(set)) continue;
        seen++;
        if (!/\bbrand_id\s*=\s*\?/.test(sql)) offenders.push(`${file}: no brand bound: ${sql}`);
        if (set.split(',').length !== 1 || !/^\s*series_id\s*=\s*(\?|NULL)\s*$/i.test(set))
          offenders.push(`${file}: sets more than series_id: ${sql}`);
      }
    }
    expect(seen, 'expected the attach and detach statements').toBeGreaterThanOrEqual(2);
    expect(offenders).toEqual([]);
  });

  test('rule 2: event_series is written only by the series handler and the detector', () => {
    const writers = sources
      .filter(({ text }) =>
        /(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+event_series\b/i.test(text)
      )
      .map((s) => s.file)
      .sort();
    expect(writers).toEqual([HANDLER, DETECTOR].sort());
  });

  test('rule 3: the detector writes pending and weekly, and never attaches an event', () => {
    const [insert] = statements(source(DETECTOR), /^\s*INSERT INTO event_series/i);
    expect(insert).toMatch(/'weekly'/);
    expect(insert).toMatch(/'pending'/);
    expect(insert).not.toMatch(/'confirmed'/);
    expect(source(DETECTOR)).not.toMatch(/UPDATE\s+events\s+SET[^`]*series_id/i);
  });

  test('rule 4: the series files read no people table and never touch FORMS_DB', () => {
    const offenders: string[] = [];
    for (const file of SERIES_FILES) {
      const text = source(file);
      if (/FORMS_DB/.test(text)) offenders.push(`${file}: FORMS_DB`);
      for (const table of PEOPLE_TABLES) {
        if (new RegExp(`\\b${table}\\b`).test(text)) offenders.push(`${file}: ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('rule 5: event_series has only the reviewed columns, and none is person-shaped', () => {
    const columns = new Set<string>();
    for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(MIGRATIONS, name), 'utf8').replace(/--.*$/gm, '');
      const create = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?event_series\s*\(([\s\S]*?)\n\);/i);
      if (create) {
        for (const line of create[1].split('\n')) {
          const m = line.match(/^\s*([a-z_]+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/);
          if (m) columns.add(m[1]);
        }
      }
      for (const m of sql.matchAll(/ALTER TABLE event_series\s+ADD COLUMN\s+([a-z_]+)/gi)) {
        columns.add(m[1]);
      }
    }
    expect([...columns].sort()).toEqual(REVIEWED_COLUMNS);
    expect([...columns].filter((c) => PERSON_SHAPED.test(c))).toEqual([]);
  });

  test('rule 6: the public reader shows a confirmed, same-brand series and five fields', () => {
    const text = source('lib/public-series.ts');
    // Every statement in the file that reads event_series carries both rules.
    const reads = statements(text, /^\s*SELECT/i).filter((sql) => /\bevent_series\b/.test(sql));
    expect(reads.length).toBe(2);
    for (const sql of reads) {
      expect(sql).toMatch(/es\.state\s*=\s*'confirmed'/);
      expect(sql).toMatch(/anchor\.brand_id\s*=\s*e\.brand_id/);
    }
    const fields = text.match(/PUBLIC_SERIES_FIELDS\s*=\s*\[([^\]]*)\]/);
    expect(fields, 'PUBLIC_SERIES_FIELDS not found').toBeTruthy();
    const names = [...(fields as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(names).toEqual(['id', 'name', 'cadence', 'day_of_week', 'hour_of_day']);
    // No third read of event_series in this file, outside those two statements.
    expect((text.match(/FROM\s+event_series|JOIN\s+event_series/gi) ?? []).length).toBe(2);
  });
});

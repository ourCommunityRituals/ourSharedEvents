/**
 * Derived gate (OSE-1782): nothing publishes a count except through count-floor.ts.
 *
 * Three properties, none of which keeps its own list of fields or functions:
 *
 *  1. Every count-shaped field in the public event projection (read out of
 *     PUBLIC_EVENT_FIELDS, not restated here) is declared in
 *     PUBLIC_EVENT_COUNT_SOURCES against a function count-floor.ts really exports.
 *     A new surface that formats its own number has no such declaration and fails.
 *  2. No privacy primitive is defined in a consumer module. The names are read out
 *     of count-floor.ts's own exports, and a `function <name>` anywhere else under
 *     src/ fails (roundForPublish used to live in shared-report-export.ts).
 *  3. The count-shaped detector and the definition scan are proven on synthetic
 *     input (negative controls), so they cannot pass by seeing nothing.
 *
 * Born red (see the OSE-1782 PR): a raw `attendee_count` added to
 * PUBLIC_EVENT_COMPUTED fails 1; a copy of roundForPublish pasted into a consumer
 * fails 2; floorCumulativeSeries with its rounding removed fails the unit
 * properties in count-floor.spec.ts.
 *
 * Placement: node project. Pure logic over imports and the source tree.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import * as countFloor from '../src/lib/count-floor';
import {
  COUNT_PUBLISHERS,
  PUBLIC_EVENT_COUNT_SOURCES,
  PUBLIC_EVENT_WORD_FIELDS,
  PUBLIC_EVENT_FIELDS,
  projectEvent,
  toPublicEvent,
} from '../src/lib/public-event-projection';
import { countShapedFields, definesFunction } from './helpers/count-shaped-fields';

const SRC = join(__dirname, '..', 'src');
const FLOOR_MODULE = join('lib', 'count-floor.ts');

const PRIMITIVES = Object.entries(countFloor)
  .filter(([, v]) => typeof v === 'function')
  .map(([name]) => name);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the detector (negative controls on synthetic input)', () => {
  test('finds count-shaped names in snake and camel case', () => {
    expect(
      countShapedFields([
        'attendee_count',
        'totalRegistrations',
        'rsvps',
        'walk_in_total',
        'people',
        'scanCount',
      ])
    ).toEqual([
      'attendee_count',
      'totalRegistrations',
      'rsvps',
      'walk_in_total',
      'people',
      'scanCount',
    ]);
  });

  test('finds compound names split across words: check-ins, walk-ins, sign-ups, attendance', () => {
    const names = [
      'check_ins',
      'checkIns',
      'checked_in',
      'checkedIn',
      'check_in',
      'walk_ins',
      'sign_ups',
      'signUps',
      'attendance',
    ];
    expect(countShapedFields(names)).toEqual(names);
  });

  test('leaves the current projection alone (no false positives)', () => {
    expect(
      countShapedFields([
        'id',
        'brand_id',
        'title',
        'slug',
        'start_date',
        'starts_at',
        'cover_image_url',
        'legal_clearance_tier',
        'corridor_id',
        'h3_res7',
        'startDateISO',
        'venue',
        'phase',
        'timezone',
      ])
    ).toEqual([]);
  });

  test('the definition scan sees a function, an exported one and an arrow const', () => {
    expect(definesFunction('export function roundForPublish(n) {}', 'roundForPublish')).toBe(true);
    expect(definesFunction('function roundForPublish (n) {}', 'roundForPublish')).toBe(true);
    expect(definesFunction('export const roundForPublish = (n) => n', 'roundForPublish')).toBe(
      true
    );
    expect(
      definesFunction('const roundForPublish = function (n) { return n; }', 'roundForPublish')
    ).toBe(true);
    expect(
      definesFunction(
        'const roundForPublish = function roundIt(n) { return n; }',
        'roundForPublish'
      )
    ).toBe(true);
    expect(
      definesFunction(
        'export const roundForPublish = async function (n) { return n; }',
        'roundForPublish'
      )
    ).toBe(true);
    expect(
      definesFunction('const roundForPublish: (n: number) => number = (n) => n', 'roundForPublish')
    ).toBe(true);
    expect(definesFunction('const x = roundForPublish(3)', 'roundForPublish')).toBe(false);
    expect(
      definesFunction("import { roundForPublish } from './count-floor'", 'roundForPublish')
    ).toBe(false);
  });
});

describe('the public event projection publishes no count except through count-floor', () => {
  test('it reads the projection own field list (not an empty one)', () => {
    expect(PUBLIC_EVENT_FIELDS.size).toBeGreaterThanOrEqual(20);
  });

  test('every count-shaped field is declared against a count-floor export', () => {
    const fields = [...PUBLIC_EVENT_FIELDS];
    // OSE-2012: a count-shaped NAME whose value is a fixed word (attendance_mode)
    // is declared in PUBLIC_EVENT_WORD_FIELDS instead; the next test holds it.
    const undeclared = countShapedFields(fields).filter(
      (f) => !(f in PUBLIC_EVENT_COUNT_SOURCES) && !(f in PUBLIC_EVENT_WORD_FIELDS)
    );
    expect(
      undeclared,
      `count-shaped field(s) in the public projection with no count-floor source: ` +
        `${undeclared.join(', ')}. Produce the value with a count-floor.ts function and ` +
        `declare it in PUBLIC_EVENT_COUNT_SOURCES.`
    ).toEqual([]);
  });

  test('a word field never publishes a number, whatever the row holds (OSE-2012)', () => {
    expect(Object.keys(PUBLIC_EVENT_WORD_FIELDS)).toEqual(['attendance_mode']);
    for (const field of Object.keys(PUBLIC_EVENT_WORD_FIELDS)) {
      const words = new Set<unknown>();
      for (const hostile of [
        3,
        0,
        4,
        '3',
        '12 people',
        1e9,
        null,
        undefined,
        true,
        [4],
        { n: 4 },
      ]) {
        const out = toPublicEvent({ id: 'e', [field]: hostile })[field];
        expect(typeof out, `${field} <- ${String(hostile)}`).toBe('string');
        expect(out, `${field} <- ${String(hostile)}`).not.toMatch(/\d/);
        words.add(out);
      }
      // Every hostile value came out as the one default word.
      expect(words.size).toBe(1);
      // A word field is never also a count field.
      expect(field in PUBLIC_EVENT_COUNT_SOURCES).toBe(false);
    }
  });

  test('every declared field is produced by its helper: a sub-floor input never comes out raw', () => {
    for (const field of Object.keys(PUBLIC_EVENT_COUNT_SOURCES)) {
      expect(
        toPublicEvent({ [field]: 3 })[field],
        `${field} is declared but published raw`
      ).not.toBe(3);
    }
  });

  test('every permitted publisher withholds (null) a sub-floor input, never 0 or the raw value', () => {
    for (const [name, publish] of Object.entries(COUNT_PUBLISHERS)) {
      for (const n of [0, 1, 2, 3, 4, -1, 4.9, Number.NaN, Infinity, 'x', null, undefined]) {
        expect(publish(n), `${name}(${String(n)})`).toBeNull();
      }
      expect(publish(5), name).toBe(5);
      expect(publish(12), name).toBe(name === 'roundForPublish' ? 10 : 12);
    }
  });

  test('planted fault: a declared field that bypasses its helper is caught, and the real projector is not', () => {
    const fields = new Set(['title', 'attendee_count']);
    const sources = { attendee_count: 'applyCountFloor' } as const;
    const bypassing = (project: (row: Record<string, unknown>) => Record<string, unknown>) =>
      Object.keys(sources).filter((f) => project({ [f]: 3 })[f] === 3);
    // A projector that copies the value unchanged (what toPublicEvent did before it consulted the declarations).
    const copying = (row: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(row).filter(([k]) => fields.has(k)));
    expect(bypassing(copying)).toEqual(['attendee_count']);
    expect(bypassing((row) => projectEvent(row, fields, sources))).toEqual([]);
    expect(projectEvent({ attendee_count: 12 }, fields, sources).attendee_count).toBe(12);
  });

  test('every declaration names a real field and a real count-floor function', () => {
    for (const [field, fn] of Object.entries(PUBLIC_EVENT_COUNT_SOURCES)) {
      expect(PUBLIC_EVENT_FIELDS.has(field), `${field} is not a projection field`).toBe(true);
      expect(PRIMITIVES, `${fn} is not exported by count-floor.ts`).toContain(fn);
    }
  });
});

describe('no privacy primitive lives in a consumer module', () => {
  test('it reads the primitives out of count-floor.ts and the source tree is not empty', () => {
    expect(PRIMITIVES).toEqual(
      expect.arrayContaining([
        'applyCountFloor',
        'floorNestedCounts',
        'floorTotalOfParts',
        'flooredRatePct',
        'floorPublishedChain',
        'floorCumulativeSeries',
        'floorCumulativeOfParts',
        'roundForPublish',
      ])
    );
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
  });

  test('floorCumulativeSeries is for floorCumulativeOfParts only: no consumer calls it on raw totals', () => {
    // Raw totals of shows that were each withheld can name them (five shows under
    // 5 total at most 20, so a published 20 says each had four). Per-show counts go
    // through floorCumulativeOfParts, which drops withheld shows before summing.
    const callers: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel === 'lib/count-floor.ts') continue;
      if (readFileSync(file, 'utf8').includes('floorCumulativeSeries')) callers.push(rel);
    }
    expect(callers).toEqual([]);
  });

  test('count-floor.ts is the only file under src/ that defines any of them', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (rel === FLOOR_MODULE || rel.split(sep).join('/') === 'lib/count-floor.ts') continue;
      const text = readFileSync(file, 'utf8');
      for (const name of PRIMITIVES) {
        if (definesFunction(text, name)) offenders.push(`${rel.split(sep).join('/')}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

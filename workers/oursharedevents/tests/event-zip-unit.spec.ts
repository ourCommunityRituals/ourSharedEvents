/**
 * W1 (OSE-2095): the ZIP field reader, the event's own zip, and the runtime
 * export guard's refusal of the zip names. Pure logic → node project.
 *
 * @born-red event-zip-unit | method: (1) `zip(_code)?|postal_code` dropped from
 *   SUB_CORRIDOR_KEY, (2) a JSON number accepted by readZipField, (3) eventZip
 *   reading the address ahead of the box; each turned a test red | date: 2026-11-16
 */
import { describe, expect, test } from 'vitest';
import { readZipField } from '../src/lib/event-zip';
import { eventZip } from '../src/lib/zip-areas';
import { assertCorridorGrainRow } from '../src/lib/export-geography';

describe('readZipField', () => {
  test('absent, null and blank', () => {
    expect(readZipField({})).toEqual({ kind: 'absent' });
    expect(readZipField({ zip_code: undefined })).toEqual({ kind: 'absent' });
    expect(readZipField({ zip_code: null })).toEqual({ kind: 'clear' });
    expect(readZipField({ zip_code: '   ' })).toEqual({ kind: 'clear' });
  });

  test('five digits; ZIP+4 and outer spaces keep five; known or not', () => {
    expect(readZipField({ zip_code: '60406' })).toEqual({ kind: 'set', zip: '60406', known: true });
    expect(readZipField({ zip_code: ' 60406-1234 ' })).toEqual({
      kind: 'set',
      zip: '60406',
      known: true,
    });
    // 60454 is a PO-box zip the Census zip-area table lacks.
    expect(readZipField({ zip_code: '60454' })).toEqual({
      kind: 'set',
      zip: '60454',
      known: false,
    });
  });

  test('fat finger: each is invalid', () => {
    for (const bad of [
      '6040',
      '604061',
      '6O406',
      'abcde',
      '604 06',
      '60406 S Pulaski Rd',
      '60406-12',
      'IL 60406',
      60406,
      true,
      ['60406'],
    ]) {
      expect(readZipField({ zip_code: bad }), JSON.stringify(bad)).toEqual({ kind: 'invalid' });
    }
  });
});

describe('eventZip: the box, else the address', () => {
  test('the box wins; else the address zip; else none', () => {
    expect(eventZip({ zip_code: '60406', where_address: 'Chicago, IL 60643' })).toBe('60406');
    expect(eventZip({ where_address: 'Chicago, IL 60643' })).toBe('60643');
    expect(eventZip({ zip_code: null, where_address: 'A hall' })).toBeNull();
    expect(eventZip({ zip_code: 'bad', where_address: 'Chicago, IL 60643' })).toBe('60643');
  });
});

describe('the runtime export guard refuses the zip names (matching the static gate)', () => {
  for (const name of ['zip', 'zip_code', 'postal_code', 'ZIP_CODE']) {
    test(`a row carrying "${name}" is refused`, () => {
      expect(() => assertCorridorGrainRow({ event_id: 'e', [name]: '60406' })).toThrow();
    });
  }
  test('a row without them passes', () => {
    expect(() => assertCorridorGrainRow({ event_id: 'e', zipper_count: 3 })).not.toThrow();
  });
});

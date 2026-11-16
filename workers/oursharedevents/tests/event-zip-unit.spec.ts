/**
 * W1 (OSE-2095): the ZIP field reader, the event's own zip, and the runtime
 * export guard's refusal of the zip names. Pure logic → node project.
 *
 * @born-red event-zip-unit | method: (1) `zip(_code)?|postal_code` dropped from
 *   SUB_CORRIDOR_KEY, (2) a JSON number accepted by readZipField, (3) eventZip
 *   reading the address ahead of the box; each turned a test red | date: 2026-11-16
 */
import { describe, expect, test } from 'vitest';
import { readZipField, suggestZip } from '../src/lib/event-zip';
import { eventZip } from '../src/lib/zip-areas';
import { findSearchPlace, inSearchPlace } from '../src/lib/place-names';
import { findPlaces, inPlaceMatches } from '../src/lib/place-search';
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

describe('suggestZip: what the wizard fills in (the server rules)', () => {
  test('the zip the address ends with, ZIP+4 kept to five', () => {
    expect(suggestZip('1 Main St, Blue Island, IL 60406-1234', 'Eagles Hall')).toEqual({
      zip: '60406',
      from: 'address',
    });
  });

  test('a town with exactly one zip, from the address or the place name', () => {
    expect(suggestZip('3200 W 95th St, Evergreen Park, IL', '')).toEqual({
      zip: '60805',
      from: 'town',
      town: 'Evergreen Park, IL',
    });
    expect(suggestZip('', 'Eagles Hall, Evergreen Park, IL')).toEqual({
      zip: '60805',
      from: 'town',
      town: 'Evergreen Park, IL',
    });
  });

  test('a town with many zips, a name that is many places, or nothing: no fill', () => {
    expect(suggestZip('1 Main St, Blue Island, IL', '')).toEqual({ zip: null, from: null });
    expect(suggestZip('', 'Rock Island Public House, Blue Island')).toEqual({
      zip: null,
      from: null,
    });
    expect(suggestZip('', 'Springfield')).toEqual({ zip: null, from: null });
    expect(suggestZip('', 'Eagles Hall')).toEqual({ zip: null, from: null });
    expect(suggestZip(undefined, 42)).toEqual({ zip: null, from: null });
  });

  test('fat finger: a street number shaped like a zip is not one', () => {
    expect(suggestZip('12345 S Pulaski Rd', '')).toEqual({ zip: null, from: null });
    expect(suggestZip('PO Box 60406', '')).toEqual({ zip: null, from: null });
  });
});

describe('inSearchPlace (/events?q=): the W1 rule through place-names', () => {
  test('a no-cell event is in the zip it gives; the box wins over the address', () => {
    const in60406 = inSearchPlace(findSearchPlace('60406')!);
    const in60643 = inSearchPlace(findSearchPlace('60643')!);
    expect(in60406({ zip_code: '60406' })).toBe(true);
    expect(in60406({ where_address: '1 Main St, Blue Island, IL 60406' })).toBe(true);
    expect(in60406({ zip_code: '60406', where_address: 'Chicago, IL 60643' })).toBe(true);
    expect(in60643({ zip_code: '60406', where_address: 'Chicago, IL 60643' })).toBe(false);
    expect(in60406({ where_address: 'A hall' })).toBe(false);
  });

  test('a PO-box zip (not in the table) matches by the box, else the address', () => {
    const po = inSearchPlace(findSearchPlace('60454')!);
    expect(po({ zip_code: '60454' })).toBe(true);
    expect(po({ where_address: 'PO Box 1, Oak Lawn, IL 60454' })).toBe(true);
    expect(po({ zip_code: '60453', where_address: 'PO Box 1, Oak Lawn, IL 60454' })).toBe(false);
    expect(po({})).toBe(false);
  });

  test('a town lists the no-cell events of every one of its zips', () => {
    const oakLawn = inSearchPlace(findSearchPlace('Oak Lawn')!);
    expect(oakLawn({ zip_code: '60453' })).toBe(true);
    expect(oakLawn({ zip_code: '60454' })).toBe(true);
    expect(oakLawn({ zip_code: '60406' })).toBe(false);
  });
});

describe('inPlaceMatches (landing ?where=): the W1 rule through place-search', () => {
  test('a no-cell event is in a town by its zip; the PO-box zip by the box', () => {
    const oakLawn = inPlaceMatches(findPlaces('Oak Lawn, IL'));
    expect(oakLawn({ zip_code: '60453' })).toBe(true);
    expect(oakLawn({ zip_code: '60454' })).toBe(true);
    expect(oakLawn({ where_address: 'PO Box 1, Oak Lawn, IL 60454' })).toBe(true);
    expect(oakLawn({ zip_code: '60406' })).toBe(false);
    expect(oakLawn({})).toBe(false);
  });
});

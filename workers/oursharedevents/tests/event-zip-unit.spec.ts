/**
 * W1 (OSE-2095): the ZIP field reader, the event's own zip, and the runtime
 * export guard's refusal of the zip names. Pure logic → node project.
 *
 * @born-red event-zip-unit | method: (1) `zip(_code)?|postal_code` dropped from
 *   SUB_CORRIDOR_KEY, (2) a JSON number accepted by readZipField, (3) eventZip
 *   reading the address ahead of the box; each turned a test red | date: 2026-11-16
 */
import { describe, expect, test } from 'vitest';
import { h3IndexToSplitLong, latLngToCell } from 'h3-js';
import {
  INVALID_ZIP_CODE,
  INVALID_ZIP_CODE_MESSAGE,
  readZipField,
  suggestZip,
  ZIP_NOT_STORED_ONLINE,
  zipNotInTableWarning,
} from '../src/lib/event-zip';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';
import { eventZip, findZipArea, inZipOwnArea } from '../src/lib/zip-areas';
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

describe('the codes and notes the API answers with', () => {
  test('a malformed ZIP: its code and what it asks for', () => {
    expect(INVALID_ZIP_CODE).toBe('INVALID_ZIP_CODE');
    expect(INVALID_ZIP_CODE_MESSAGE).toBe(
      'zip_code must be a 5-digit US ZIP code ("60406", or "60406-1234" which keeps the first five), or empty to clear it'
    );
  });

  test('a ZIP the table lacks: saved, with a note naming it', () => {
    expect(zipNotInTableWarning('60454')).toEqual({
      code: 'ZIP_NOT_IN_TABLE',
      message:
        'ZIP 60454 was saved, but it is not in the zip-area table (a PO-box ZIP, or a typo). A search for it finds this event only by the ZIP itself.',
    });
  });

  test('a ZIP with an online event: not stored, and the answer says so', () => {
    expect(ZIP_NOT_STORED_ONLINE).toEqual({
      code: 'ZIP_NOT_STORED_ONLINE',
      message: 'An online event has no place, so the ZIP code was not stored.',
    });
  });
});

describe('inZipOwnArea: a cell that is not text is no cell', () => {
  test('a valid cell as a split-long pair is read as no cell, so the zip decides', () => {
    const cell = latLngToCell(41.6939, -87.7025, CORRIDOR_RES); // 60655 (Mount Greenwood)
    const mine = inZipOwnArea(findZipArea('60655')!);
    // h3-js counts the pair as a valid cell; only `typeof` keeps it out.
    expect(mine({ h3_res7: h3IndexToSplitLong(cell), zip_code: '60655' })).toBe(true);
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
  // The same list's cell names, by name alone (the value is not cell-shaped, so
  // only the name can refuse it): a bare "h3", and a two-digit resolution.
  for (const name of ['h3', 'h3_res10', 'H3_RES15']) {
    test(`a row carrying "${name}" is refused by its name`, () => {
      expect(() => assertCorridorGrainRow({ event_id: 'e', [name]: 'withheld' })).toThrow(
        `sub-corridor column "${name}"`
      );
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

  test('the town is the last part of an address, never the address alone', () => {
    // "Evergreen Park" alone (no state) as the last part of an address.
    expect(suggestZip('123 Main St, Evergreen Park', '')).toEqual({
      zip: '60805',
      from: 'town',
      town: 'Evergreen Park, IL',
    });
    // An address with no comma is never read as a town by itself.
    expect(suggestZip('Evergreen Park', '')).toEqual({ zip: null, from: null });
    // The place name alone is: the whole text is tried for it.
    expect(suggestZip('', 'Evergreen Park')).toEqual({
      zip: '60805',
      from: 'town',
      town: 'Evergreen Park, IL',
    });
    // A trailing comma is an empty part, dropped; so is a blank one after it.
    for (const tail of [',', ', ', ',  ,']) {
      expect(suggestZip(`3200 W 95th St, Evergreen Park, IL${tail}`, ''), tail).toEqual({
        zip: '60805',
        from: 'town',
        town: 'Evergreen Park, IL',
      });
    }
  });

  test('fat finger: only the first 500 characters of each box are read', () => {
    const pad = 'x'.repeat(495);
    const long = `${pad}, Evergreen Park, IL 60805`;
    expect(suggestZip(long, long)).toEqual({ zip: null, from: null });
    // The same text short enough is read.
    expect(suggestZip(`x, Evergreen Park, IL 60805`, '')).toEqual({
      zip: '60805',
      from: 'address',
    });
    // The place name's cut: 498 characters and ", " fill the 500, so the town
    // after them is never read; the same name short is.
    expect(suggestZip('', `${'x'.repeat(498)}, Evergreen Park, IL`)).toEqual({
      zip: null,
      from: null,
    });
    expect(suggestZip('', 'x, Evergreen Park, IL')).toEqual({
      zip: '60805',
      from: 'town',
      town: 'Evergreen Park, IL',
    });
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

  test('an event WITH a cell in a Census zip is found by its cell, no zip given', () => {
    const cell = latLngToCell(41.6939, -87.7025, CORRIDOR_RES); // 60655 (Mount Greenwood)
    expect(inSearchPlace(findSearchPlace('60655')!)({ h3_res7: cell })).toBe(true);
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

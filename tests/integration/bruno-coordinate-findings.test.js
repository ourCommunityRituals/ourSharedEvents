/**
 * OSE-2197: the staging check that no public event answer carries a point.
 *
 * Bruno's OSE-2197 requests (bruno/ose-api/28. Public answers carry the cell
 * (OSE-2197)/) read the public answers on staging and pass each body to
 * bruno/ose-api/lib/coordinate-findings.js. This file proves, without staging:
 *   - the module passes a clean answer (dates with fractions of a second, a
 *     price, a booth's place on its hall plan) and fails each injected
 *     coordinate: a coordinate-named field, a coordinate-shaped number, a pair
 *     in a maps link, a cell finer than res 7;
 *   - the workers-pool helper (workers/oursharedevents/tests/helpers/
 *     coordinate-findings.ts) gives the same findings on the same answers, so
 *     the two layers fail on the same thing;
 *   - every OSE-2197 read request calls both checks.
 *
 * @born-red OSE-2197 Bruno | method: the fault cases below are the injected
 *   coordinates; with the key rule, the number rule, the pair rule and the
 *   finer-cell rule each removed from the module in turn, this file ran red (4,
 *   3, 2 and 1 tests), each put back | date: 2026-11-19
 */
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const LIB = join(ROOT, 'bruno/ose-api/lib/coordinate-findings.js');
const FOLDER = join(ROOT, 'bruno/ose-api/28. Public answers carry the cell (OSE-2197)');
const bruno = require(LIB);

const CLEAN = {
  ok: true,
  status: 200,
  items: [
    {
      id: 'map-zoom-a',
      h3_res7: '872664405ffffff',
      corridor_id: null,
      where_address: '13328 Olde Western Ave, Blue Island, IL 60406',
      starts_at: '2026-11-22T22:54:30.123Z',
      updated_at: '2026-11-19 22:54:30',
      price: 12.5,
    },
  ],
  booths: [{ id: 'b1', number: 'A1', hall_x: 0.125, hall_y: 0.3333 }],
};

const FAULTS = {
  'a lat field': { item: { id: 'e', lat: 41.6573 } },
  'a lon field set to null': { item: { id: 'e', lon: null } },
  'a name built on one': { item: { venue_lng: 1 } },
  'a geo structure': { items: [{ geo: { a: 1 } }] },
  'a coordinate-shaped number under any name': { item: { x: 41.657312 } },
  'a coordinate pair in an array': { item: { at: [41.657, -87.681] } },
  'a pair in a maps link': { item: { url: 'https://maps.apple.com/?ll=41.657,-87.681' } },
  'a pair encoded in a query': { item: { url: 'query=41.657%2C-87.681' } },
};

let workers;
beforeAll(async () => {
  workers = await import('../../workers/oursharedevents/tests/helpers/coordinate-findings.ts');
});

describe('OSE-2197 | the staging coordinate check', () => {
  test('a clean public answer has no finding, at either layer', () => {
    expect(bruno.coordinateFindings(CLEAN)).toEqual([]);
    expect(workers.coordinateFindings(CLEAN)).toEqual([]);
    expect(bruno.finerCells(CLEAN)).toEqual([]);
  });

  for (const [name, answer] of Object.entries(FAULTS)) {
    test(`fails on ${name}, with the same findings at both layers`, () => {
      const found = bruno.coordinateFindings(answer);
      expect(found.length, name).toBeGreaterThan(0);
      expect(workers.coordinateFindings(answer)).toEqual(found);
    });
  }

  test('fails on a cell finer than res 7, and passes a res-7 cell', () => {
    expect(bruno.finerCells({ item: { cell: '89266454447ffff' } })).not.toEqual([]);
    expect(bruno.finerCells({ item: { cell: '8f2664544000000' } })).not.toEqual([]);
    expect(bruno.finerCells({ item: { h3_res7: '872664405ffffff' } })).toEqual([]);
  });

  test('every OSE-2197 read request calls both checks on its answer', () => {
    const reads = readdirSync(FOLDER).filter((f) => / - read - .*\.yml$/.test(f));
    expect(reads.length, 'the OSE-2197 read requests').toBeGreaterThanOrEqual(6);
    for (const f of reads) {
      const yml = readFileSync(join(FOLDER, f), 'utf8');
      expect(yml, f).toContain("require('./lib/coordinate-findings.js')");
      expect(yml, f).toMatch(/coordinateFindings\(/);
      expect(yml, f).toMatch(/finerCells\(/);
      expect(yml, f).toContain('X-Test-No-Auth');
    }
  });
});

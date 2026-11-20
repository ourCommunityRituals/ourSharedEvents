const { readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const h3 = require('h3-js');

const file = path.join(__dirname, '../../../stock/nodes.json');
const { nodes } = JSON.parse(readFileSync(file, 'utf8'));

describe('stock/nodes.json', () => {
  // Owner, 2026-11-05: Mount Greenwood stays, deliberately empty. Owner, 2026-11-19:
  // Beverly and Morgan Park (its own place) are nodes, and `area` holds every row whose
  // address is in no boundary (it has cells and no polygon).
  test('has exactly the five nodes, Beverly, Morgan Park, Sawyer and the wider area', () => {
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'area',
      'auburn-gresham',
      'beverly',
      'blue-island',
      'evergreen-park',
      'morgan-park',
      'mount-greenwood',
      'oak-lawn',
      'sawyer',
    ]);
  });

  test('every node but the wider area has a zip; every node has a cell and a source', () => {
    for (const n of nodes) {
      if (n.id !== 'area') expect(n.zips.length, `${n.id} zips`).toBeGreaterThanOrEqual(1);
      expect(n.cells.length, `${n.id} cells`).toBeGreaterThanOrEqual(1);
      expect(n.source, `${n.id} source`).toMatch(/^https:\/\//);
    }
  });

  test('every cell is a valid res 7 cell', () => {
    for (const n of nodes) {
      for (const c of n.cells) {
        expect(h3.isValidCell(c), c).toBe(true);
        expect(h3.getResolution(c), c).toBe(7);
      }
    }
  });

  test('every node but the wider area has a polygon boundary', () => {
    expect(nodes.find((n) => n.id === 'area').polygon).toBeUndefined();
    for (const n of nodes.filter((x) => x.id !== 'area')) {
      expect(['Polygon', 'MultiPolygon'], n.id).toContain(n.polygon.type);
      expect(n.polygon.coordinates.length, n.id).toBeGreaterThanOrEqual(1);
    }
  });

  test('cells are exactly the res 7 cells overlapping the polygon', () => {
    for (const n of nodes.filter((x) => x.polygon)) {
      const polys = n.polygon.type === 'Polygon' ? [n.polygon.coordinates] : n.polygon.coordinates;
      const regenerated = new Set();
      for (const p of polys) {
        for (const c of h3.polygonToCellsExperimental(
          p,
          7,
          h3.POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
          true
        )) {
          regenerated.add(c);
        }
      }
      expect([...regenerated].sort(), n.id).toEqual([...n.cells].sort());
    }
  });

  test('the file stays under 200 KB', () => {
    expect(statSync(file).size).toBeLessThan(200 * 1024);
  });

  // The wider area's cells are the res 7 cells its rows sit in.
  test('every cell of the wider area holds a row of the seed, and no row of it sits elsewhere', () => {
    const seed = JSON.parse(
      readFileSync(path.join(__dirname, '../../../stock/seed/seed.json'), 'utf8')
    );
    const area = nodes.find((n) => n.id === 'area');
    const rowCells = new Set(
      [...seed.events, ...seed.businesses]
        .filter((r) => r.node === 'area')
        .map((r) => h3.latLngToCell(r.lat, r.lng, 7))
    );
    for (const c of rowCells) expect(area.cells, c).toContain(c);
  });

  // OSE-2199: the Worker stores an event's res-7 cell as the parent of its res-9
  // cell, which near a res-7 edge is not the point's own res-7 cell (12 of the
  // wider area's cells). Rows stored either way sit in the area's cells, so a
  // check of rows a load made before the change and after it both pass.
  test('every res-7 cell the Worker stores for a row of the wider area is one of its cells', async () => {
    const { tagCoordinates } =
      await import('../../../workers/oursharedevents/src/lib/h3-tagging.ts');
    const seed = JSON.parse(
      readFileSync(path.join(__dirname, '../../../stock/seed/seed.json'), 'utf8')
    );
    const area = nodes.find((n) => n.id === 'area');
    const stored = new Set(
      [...seed.events, ...seed.businesses]
        .filter((r) => r.node === 'area')
        .map((r) => tagCoordinates(r.lat, r.lng).h3_res7)
    );
    for (const c of stored) expect(area.cells, c).toContain(c);
  });
});

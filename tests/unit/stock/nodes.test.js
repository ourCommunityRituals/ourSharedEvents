const { readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const h3 = require('h3-js');

const file = path.join(__dirname, '../../../stock/nodes.json');
const { nodes } = JSON.parse(readFileSync(file, 'utf8'));

describe('stock/nodes.json', () => {
  // Owner, 2026-11-05: Beverly is dropped; Mount Greenwood stays, deliberately empty.
  test('has exactly the five nodes', () => {
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'auburn-gresham',
      'blue-island',
      'evergreen-park',
      'mount-greenwood',
      'oak-lawn',
    ]);
  });

  test('every node has a zip, a cell and a source', () => {
    for (const n of nodes) {
      expect(n.zips.length, `${n.id} zips`).toBeGreaterThanOrEqual(1);
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

  test('every node has a polygon boundary', () => {
    for (const n of nodes) {
      expect(['Polygon', 'MultiPolygon'], n.id).toContain(n.polygon.type);
      expect(n.polygon.coordinates.length, n.id).toBeGreaterThanOrEqual(1);
    }
  });

  test('cells are exactly the res 7 cells overlapping the polygon', () => {
    for (const n of nodes) {
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
});

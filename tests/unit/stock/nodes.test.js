const { readFileSync } = require('node:fs');
const path = require('node:path');
const h3 = require('h3-js');

const { nodes } = JSON.parse(
  readFileSync(path.join(__dirname, '../../../stock/nodes.json'), 'utf8')
);

describe('stock/nodes.json', () => {
  test('has exactly the six nodes', () => {
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'auburn-gresham',
      'beverly',
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

  test('no cell appears in two nodes', () => {
    const all = nodes.flatMap((n) => n.cells);
    expect(new Set(all).size).toBe(all.length);
  });
});

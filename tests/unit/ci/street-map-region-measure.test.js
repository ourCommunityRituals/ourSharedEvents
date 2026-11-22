/**
 * Street-map regions (OSE-2210): the region files the street map is cut to,
 * one archive per region (owner, 2026-11-22), and the measure-only workflow
 * that sizes them (.github/workflows/street-map-region-measure.yml).
 *
 * The workflow must never write: no bucket credential, no upload tool, no
 * environment, read-only token. The load workflow stays the one writer.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../../');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const WORKFLOW = '.github/workflows/street-map-region-measure.yml';

let m;
beforeAll(async () => {
  m = await import('../../../scripts/ci/street-map-region-measure.mjs');
});

const box = (w, s, e, n) => [
  [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ],
];
const feature = (polygons) =>
  JSON.stringify({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polygons } });

describe('region files: closed boxes on the globe', () => {
  it('passes a box and every region file in the repo', () => {
    expect(m.regionProblems(feature([box(-10, -10, 10, 10)]))).toEqual([]);
    for (const file of Object.values(m.REGIONS)) {
      expect(m.regionProblems(read(file)), file).toEqual([]);
    }
  });

  it.each([
    ['not JSON', '{'],
    [
      'a Polygon, not a MultiPolygon',
      JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: box(0, 0, 1, 1) },
      }),
    ],
    [
      'an open ring',
      feature([
        [
          box(0, 0, 1, 1)[0]
            .slice(0, 4)
            .concat([[0.5, 0.5]]),
        ],
      ]),
    ],
    [
      'a ring that is not a box',
      feature([
        [
          [
            [0, 0],
            [1, 0],
            [2, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      ]),
    ],
    ['a box off the globe', feature([box(170, 0, 181, 1)])],
    ['a box with no area', feature([box(0, 0, 0, 1)])],
    ['a hole', feature([[box(0, 0, 2, 2)[0], box(0.5, 0.5, 1, 1)[0]]])],
  ])('stops on %s', (_name, text) => {
    expect(m.regionProblems(text).length).toBeGreaterThan(0);
  });
});

describe('North America is three region archives that between them cover it', () => {
  // Points people will put events at, by the region whose file must hold them.
  const PLACES = {
    us: [
      ['Chicago', -87.63, 41.88],
      ['Anchorage', -149.9, 61.22],
      ['Honolulu', -157.86, 21.31],
      ['San Juan', -66.11, 18.47],
      ['Adak', -176.66, 51.88],
    ],
    ca: [
      ['Toronto', -79.38, 43.65],
      ['Vancouver', -123.12, 49.28],
      ['Montreal', -73.57, 45.5],
      ["St. John's", -52.71, 47.56],
      ['Halifax', -63.58, 44.65],
      ['Whitehorse', -135.06, 60.72],
      ['Iqaluit', -68.52, 63.75],
      ['Windsor', -83.03, 42.31],
    ],
    mx: [
      ['Mexico City', -99.13, 19.43],
      ['Tijuana', -117.04, 32.51],
      ['Cancun', -86.85, 21.16],
      ['Guatemala City', -90.51, 14.63],
      ['Panama City', -79.52, 8.98],
      ['Havana', -82.37, 23.11],
      ['Kingston', -76.79, 17.97],
      ['Santo Domingo', -69.93, 18.49],
      ['Bridgetown', -59.6, 13.1],
      ['Port of Spain', -61.51, 10.66],
      ['Nassau', -77.34, 25.06],
      ['Hamilton, Bermuda', -64.78, 32.29],
    ],
  };

  it.each(Object.entries(PLACES).flatMap(([r, list]) => list.map((p) => [r, ...p])))(
    '%s holds %s',
    (region, _name, lon, lat) => {
      expect(m.regionCovers(read(m.REGIONS[region]), lon, lat)).toBe(true);
    }
  );

  it('a border town draws whole from either side: Detroit is in us and ca', () => {
    expect(m.regionCovers(read(m.REGIONS.us), -83.05, 42.33)).toBe(true);
    expect(m.regionCovers(read(m.REGIONS.ca), -83.05, 42.33)).toBe(true);
  });

  it('Greenland is not in any region file (left out on purpose)', () => {
    for (const file of Object.values(m.REGIONS)) {
      expect(m.regionCovers(read(file), -51.72, 64.18), `Nuuk in ${file}`).toBe(false);
    }
  });

  it('the United States file is the one the load workflow cuts', () => {
    expect(read('.github/workflows/street-map-archive-load.yml')).toContain(
      `REGION_FILE: ${m.REGIONS.us}\n`
    );
  });
});

describe('target: the names a dry run uses', () => {
  const wf = "env:\n  PROTOMAPS_BUILD: '20261120'\n";
  it('names the region file, a <region>-<build> key and the load workflow build', () => {
    expect(m.regionTarget('ca', wf)).toEqual({
      problems: [],
      file: m.REGIONS.ca,
      key: 'ca-20261120.pmtiles',
      build: '20261120',
    });
  });
  it('reads the build the load workflow really names', () => {
    expect(m.loadWorkflowBuild(read(m.LOAD_WORKFLOW))).toMatch(/^\d{8}$/);
  });
  it.each([
    ['an unknown region', 'zz', wf],
    ['an inherited name', 'constructor', wf],
    ['no build in the load workflow', 'us', 'env:\n'],
  ])('stops on %s', (_n, region, text) => {
    expect(m.regionTarget(region, text).problems.length).toBeGreaterThan(0);
  });
});

/** What makes the measure workflow able to write, as sentences. */
function writeProblems(text) {
  const out = [];
  const doc = yaml.load(text);
  if (JSON.stringify(doc.permissions) !== JSON.stringify({ contents: 'read' })) {
    out.push('top-level permissions are not contents: read');
  }
  for (const [name, job] of Object.entries(doc.jobs ?? {})) {
    if (job.permissions) out.push(`${name} sets its own permissions`);
    if (job.environment) out.push(`${name} names an environment`);
  }
  if (/secrets\./.test(text)) out.push('reads a secret');
  if (/\brclone\b|wrangler|upload-artifact|aws |r2\.cloudflarestorage/.test(text)) {
    out.push('carries an upload tool or a bucket address');
  }
  const runs = Object.values(doc.jobs ?? {})
    .flatMap((j) => j.steps ?? [])
    .map((s) => s.run ?? '')
    .join('\n');
  for (const line of runs.split('\n').filter((l) => /pmtiles extract/.test(l))) {
    if (!/ --dry-run(\s|$)/.test(line)) out.push('runs pmtiles extract without --dry-run');
  }
  const regions = doc.on?.workflow_dispatch?.inputs?.region?.options ?? [];
  const known = Object.keys(m.REGIONS);
  if (
    regions
      .filter((r) => r !== 'all')
      .sort()
      .join() !== [...known].sort().join()
  ) {
    out.push(`the dispatch regions "${regions}" are not the regions ${known}`);
  }
  return out;
}

describe('the measure workflow writes nothing', () => {
  it('passes as written', () => {
    expect(writeProblems(read(WORKFLOW))).toEqual([]);
  });

  it.each([
    ['a write permission', (t) => t.replace('  contents: read', '  contents: write')],
    ['a secret', (t) => t.replace("'14'", '${{ secrets.R2_MAP_TILES_SECRET_KEY }}')],
    [
      'the load environment',
      (t) =>
        t.replace(
          '    needs: [regions]\n',
          '    needs: [regions]\n    environment: street-map-load\n'
        ),
    ],
    [
      'an upload',
      (t) =>
        t.replace(
          './pmtiles version',
          './pmtiles version\n          rclone copy x r2:ose-map-tiles'
        ),
    ],
    ['a real cut', (t) => t.replace(' --dry-run 2>&1', ' 2>&1')],
    ['a region missing from the dispatch list', (t) => t.replace('          - mx\n', '')],
  ])('stops on %s', (_n, fault) => {
    const text = read(WORKFLOW);
    const faulted = fault(text);
    expect(faulted).not.toBe(text);
    expect(writeProblems(faulted).length).toBeGreaterThan(0);
  });
});

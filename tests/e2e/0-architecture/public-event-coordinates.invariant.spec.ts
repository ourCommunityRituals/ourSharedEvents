/**
 * INVARIANT: a public event answer carries the event's cell, never its stored point
 *
 * Owner ruling, 2026-11-19 (OSE-2197): "It should resolve to the H3." "This is
 * the whole point of the H3 layer." "The entire data set should be resolving to
 * the H3 layer and the map item, and then use the address as a secondary
 * source." AGENTS.md invariant 3 (place, not person). Events are stored with
 * `lat`, `lon`, `h3_res9` and `h3_res7`; the public answers give the res-7 cell
 * (`h3_res7`, `corridor_id`) and never the point. (The address in that ruling is
 * a tie-break for which cell an event belongs to near a cell edge, decided on
 * save, OSE-2199; it is not a source for these answers.)
 *
 * What this L0 gate holds, from the Worker source:
 *
 *   1. THE PROJECTION. PUBLIC_EVENT_COLUMNS and PUBLIC_EVENT_COMPUTED
 *      (lib/public-event-projection.ts, the allowlist behind every public event
 *      answer) name no coordinate and no cell finer than res 7.
 *   2. THE MAP READ. In handlers/events-map.ts the MapEvent shape, the item each
 *      row becomes and every SELECT name no coordinate. (Its COORDINATE_PARAMS
 *      list is the refusal of a coordinate coming IN, which stays.)
 *   3. THE PUBLIC RESPONSE BUILDERS name no coordinate at all, select no `*`
 *      and spread no row (which would pass the point through unnamed): the list and the
 *      read (handleListEvents, handleGetEvent), the poster bundle, the TV's
 *      display-config, the brand calendar feed, sponsor discovery's event
 *      (toDiscoverable), the public sponsor and booth projections, the
 *      SharedReport read and the UEC resolver. The SharedReport builder's event
 *      SELECTs read no point.
 *   4. THE ZOOMED MAP. ZoomEvent (lib/attendee-map.ts) declares no coordinate,
 *      and mapDots reads none and derives no cell from one: a dot is placed
 *      from the event's res-9 cell, which the landing passes beside the
 *      projected event: the stored h3_res9, else the cell the server derives
 *      from the stored point (lib/landing-area.ts blockOf; owner, 2026-11-09: a
 *      dot at its block's centre). The landing's own row stays on the server.
 *   5. THE PUBLIC TEMPLATES. No public page template (src/templates/*.html but
 *      the admin ones) and no script a public page carries (lib/map-pan-script.ts,
 *      lib/map-tip-script.ts, lib/area-tabs-script.ts) reads a coordinate field: no `.lat`, `.lon`,
 *      `.lng`, `.latitude` or `.longitude`, no quoted coordinate key, no
 *      `data-lat`. The visitor's own position from the Geolocation API
 *      (`coords.latitude`, `coords.longitude`) is not an event's; it is taken
 *      out before the check (invariant 4: it picks what to show and is never
 *      stored).
 *   6. THE GATE CAN FAIL. Each rule is run on its real source with a
 *      coordinate injected (a projection column, a finer cell, a map item
 *      field, a response field, a template read, a point-derived dot) and must
 *      report it.
 *
 * A coordinate name: lat, lon, lng, latitude, longitude, or a name built on one
 * (`venue_lat`, `lat_lng`), or geo, coords, coordinates, position, latlng, ll.
 *
 * NOT HELD HERE, named so the gap is visible: the Directions links. Since
 * OSE-2196 (#1494) the event page reads no stored point at all, and its links
 * and the poster's go to the event's res-9 cell point (lib/cell-point.ts,
 * lib/geo-link.ts eventDirections / eventDirectionsQuery), else its res-7
 * area's, else a search for the address. That point reaches the public poster
 * bundle as `directions.query`, the one narrow exception the runtime gate
 * allows (workers/oursharedevents/tests/public-event-no-coordinates.spec.ts);
 * the source side is held by workers/oursharedevents/tests/route-offer-gate.spec.ts
 * (no directions builder is handed a stored lat or lon).
 * (templates/poster.html is scanned by rule 5.)
 * Admin routes keep reading and writing lat and lon (out of scope).
 *
 * The runtime layer is the workers-pool spec
 * workers/oursharedevents/tests/public-event-no-coordinates.spec.ts and, on
 * staging, Bruno's OSE-2197 requests, which read the answers themselves.
 *
 * @born-red OSE-2197 T0 | method: section 6 below injects each fault into a copy
 *   of the real source on every run (its first run caught this file's own
 *   defect: mapDots' `{ … }` return type was read as its body). By hand against
 *   the tree: the three source files put back as they are on main at adbc428
 *   (rules 1, 2 and 4 ran red, naming lat and lon in the projection, MapEvent,
 *   the map item and SELECT, ZoomEvent and mapDots' latLngToCell), and
 *   `item.lat` read in templates/display.html (rule 5 ran red); each put back
 *   | date: 2026-11-19
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
const read = (rel: string): string => {
  const path = join(SRC, rel);
  expect(existsSync(path), `${rel} must exist (a moved file must move this gate with it)`).toBe(
    true
  );
  return readFileSync(path, 'utf8');
};

// ── Names ────────────────────────────────────────────────────────────────────

const COORD = '(?:lat|lon|lng|latitude|longitude)';
const COORDINATE_NAME = new RegExp(
  `^(?:geo|coords?|coordinates|position|latlng|lat_lng|lat_lon|ll)$|(?:^|_)${COORD}(?:_|$)`,
  'i'
);
/** A coordinate named anywhere in code, as a word. */
const COORDINATE_WORD = new RegExp(`\\b${COORD}\\b|\\b(?:coords|coordinates)\\s*:`, 'i');
/** H3 resolutions 8 to 15, finer than the res 7 a public event answer carries. */
const FINER_CELL = /^h3_res(?:[89]|1[0-5])$/;

// ── Source reading ───────────────────────────────────────────────────────────

/**
 * Code without its comments: block comments, and `//` comments outside a string.
 *
 * LIMIT, by design: this and `braced` read text, not a syntax tree. A `/*`, `}`
 * or `{` inside a string can cut a body short or run it long, so a rule can
 * look at less (or more) than the function. Each scoped body is checked to hold
 * a `return` (functionBody), and the runtime spec
 * (workers/oursharedevents/tests/public-event-no-coordinates.spec.ts) reads the
 * real answers, so a mis-read here is a narrower gate, not a missing one.
 */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlocks
    .split('\n')
    .map((line) => {
      for (let i = line.indexOf('//'); i !== -1; i = line.indexOf('//', i + 2)) {
        const before = line.slice(0, i);
        const quotes = (q: string) => before.split(q).length - 1;
        if (quotes("'") % 2 === 0 && quotes('"') % 2 === 0 && quotes('`') % 2 === 0) {
          return before;
        }
      }
      return line;
    })
    .join('\n');
}

/** From `from` (an index of an opening `{`), the text up to its matching `}`. */
function braced(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error('unbalanced braces');
}

/**
 * The body of a function declared by `signature` (its text up to the name). The
 * body opens at the first `{` that ends a line after the parameters, so a return
 * type written as `{ … }` on the signature line is passed over (mapDots has one).
 * A body that does not return is not a body, and fails here rather than
 * passing every check with nothing in it.
 */
function functionBody(src: string, signature: string, where: string): string {
  const at = src.indexOf(signature);
  expect(at, `${where}: ${signature} not found`).toBeGreaterThan(-1);
  let depth = 0;
  let i = src.indexOf('(', at);
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) break;
  }
  const body = braced(src, src.indexOf('{\n', i));
  expect(body, `${where}: ${signature} body not read`).toMatch(/\breturn\b/);
  return body;
}

/** The string literals of an array constant, its comments ignored. */
function arrayLiterals(src: string, name: string): string[] {
  const at = src.indexOf(`const ${name} = [`);
  expect(at, `const ${name} = [ not found`).toBeGreaterThan(-1);
  const body = stripComments(src.slice(at, src.indexOf(']', at)));
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

// ── The rules ────────────────────────────────────────────────────────────────

function projectionFindings(src: string): string[] {
  const out: string[] = [];
  for (const list of ['PUBLIC_EVENT_COLUMNS', 'PUBLIC_EVENT_COMPUTED']) {
    for (const field of arrayLiterals(src, list)) {
      if (COORDINATE_NAME.test(field)) out.push(`${list} names ${field}`);
      if (FINER_CELL.test(field)) out.push(`${list} names ${field}, finer than res 7`);
    }
  }
  return out;
}

/** The column list of every SELECT in `src` (the text between SELECT and FROM). */
function selectColumns(src: string): string[] {
  return [...src.matchAll(/SELECT\s+([\s\S]*?)\s+FROM\s/gi)].map((m) => m[1]!);
}

function mapReadFindings(src: string): string[] {
  const out: string[] = [];
  const code = stripComments(src);
  const shapeAt = code.indexOf('interface MapEvent {');
  expect(shapeAt, 'events-map.ts: interface MapEvent not found').toBeGreaterThan(-1);
  const shape = braced(code, code.indexOf('{', shapeAt));
  if (COORDINATE_WORD.test(shape)) out.push('MapEvent declares a coordinate');
  const itemAt = code.indexOf('const items: MapEvent[] =');
  expect(itemAt, 'events-map.ts: the items built from the rows not found').toBeGreaterThan(-1);
  const item = code.slice(itemAt, code.indexOf('}));', itemAt));
  if (COORDINATE_WORD.test(item)) out.push('the map item carries a coordinate');
  for (const cols of selectColumns(code)) {
    if (COORDINATE_WORD.test(cols)) out.push(`a SELECT reads a coordinate: ${cols.trim()}`);
  }
  return out;
}

/**
 * A builder names no coordinate, and cannot pass one through unnamed: no
 * `SELECT *` (or `alias.*`) and no spread of a row (`...row`, `...e`), which
 * would carry every stored column, the point included, into the answer.
 */
function builderFindings(code: string, where: string): string[] {
  const body = stripComments(code);
  const out: string[] = [];
  const m = COORDINATE_WORD.exec(body);
  if (m) out.push(`${where} names ${m[0]}`);
  if (/SELECT\s+(?:\w+\.)?\*/i.test(body)) out.push(`${where} selects every column`);
  if (/\.\.\.\s*(?:row|rows|r|e|ev|event|item)\b/.test(body)) out.push(`${where} spreads a row`);
  return out;
}

function zoomFindings(src: string): string[] {
  const out: string[] = [];
  const code = stripComments(src);
  const shapeAt = code.indexOf('export interface ZoomEvent');
  expect(shapeAt, 'attendee-map.ts: ZoomEvent not found').toBeGreaterThan(-1);
  const shape = braced(code, code.indexOf('{', shapeAt));
  if (new RegExp(`^\\s*${COORD}\\??\\s*:`, 'im').test(shape)) {
    out.push('ZoomEvent declares a coordinate');
  }
  const dots = functionBody(code, 'export function mapDots(', 'attendee-map.ts');
  if (/\blatLngToCell\s*\(/.test(dots)) out.push('mapDots derives a cell from a point');
  const reads = new RegExp(`\\be\\.${COORD}\\b|\\be\\[\\s*['"]${COORD}['"]\\s*\\]`, 'i');
  if (reads.test(dots)) out.push("mapDots reads an event's coordinate");
  // Destructured from the event (`const { lat, lon } = e`), or taken whole.
  const taken = new RegExp(`\\{[^{}]*\\b${COORD}\\b[^{}]*\\}\\s*=\\s*(?:e|ev|event)\\b`, 'i');
  if (taken.test(dots)) out.push("mapDots destructures an event's coordinate");
  return out;
}

/** The visitor's own position (Geolocation API), which is not an event's. */
const OWN_POSITION = /\bcoords\.(?:latitude|longitude)\b/g;

function templateFindings(text: string, where: string): string[] {
  const t = text.replace(OWN_POSITION, 'coords.OWN');
  const rules: [RegExp, string][] = [
    [new RegExp(`\\.${COORD}\\b`, 'i'), 'reads a coordinate field'],
    [new RegExp(`['"]${COORD}['"]`, 'i'), 'names a quoted coordinate key'],
    [new RegExp(`\\bdata-${COORD}\\b`, 'i'), 'writes a coordinate data attribute'],
  ];
  return rules.filter(([re]) => re.test(t)).map(([, why]) => `${where} ${why}`);
}

// ── The sources ──────────────────────────────────────────────────────────────

const PROJECTION = 'lib/public-event-projection.ts';
const MAP_READ = 'handlers/events-map.ts';
const ZOOM = 'lib/attendee-map.ts';

/** Public response builders read whole: none of them names a coordinate. */
const WHOLE_FILE_BUILDERS = [
  'handlers/poster-bundle.ts',
  'handlers/display-config.ts',
  'handlers/brand-calendar.ts',
  'handlers/shared-report-read.ts',
  'handlers/uec-resolve.ts',
  'lib/public-sponsor-projection.ts',
  'lib/public-booths.ts',
];

/** Public response builders inside a file that also holds admin or internal code. */
const FUNCTION_BUILDERS: [file: string, signature: string][] = [
  ['handlers/events.ts', 'export async function handleListEvents('],
  ['handlers/events.ts', 'export async function handleGetEvent('],
  ['lib/sponsor-discovery.ts', 'export function toDiscoverable('],
];

const PAGE_SCRIPTS = ['lib/map-pan-script.ts', 'lib/map-tip-script.ts', 'lib/area-tabs-script.ts'];

function publicTemplates(): string[] {
  return readdirSync(join(SRC, 'templates'))
    .filter((f) => f.endsWith('.html') && !f.startsWith('admin'))
    .map((f) => `templates/${f}`);
}

// ── 1 to 5: the real source ──────────────────────────────────────────────────

test.describe('OSE-2197 | public event answers carry the cell, never the stored point', () => {
  test('1. the public projection names no coordinate and no cell finer than res 7', () => {
    const src = read(PROJECTION);
    expect(arrayLiterals(src, 'PUBLIC_EVENT_COLUMNS')).toContain('h3_res7');
    expect(projectionFindings(src)).toEqual([]);
  });

  test('2. the map read gives each pin its cell, never a coordinate', () => {
    expect(mapReadFindings(read(MAP_READ))).toEqual([]);
  });

  test('3. no public response builder names a coordinate', () => {
    const findings: string[] = [];
    for (const rel of WHOLE_FILE_BUILDERS) findings.push(...builderFindings(read(rel), rel));
    for (const [rel, sig] of FUNCTION_BUILDERS) {
      findings.push(...builderFindings(functionBody(read(rel), sig, rel), `${rel} ${sig}`));
    }
    const report = 'lib/shared-report-builder.ts';
    for (const cols of selectColumns(stripComments(read(report)))) {
      if (COORDINATE_WORD.test(cols)) findings.push(`${report} SELECTs a coordinate`);
    }
    expect(findings).toEqual([]);
  });

  test('4. the zoomed map places a dot from its res-9 cell and reads no point', () => {
    expect(zoomFindings(read(ZOOM))).toEqual([]);
  });

  test('5. no public template or page script reads a coordinate field', () => {
    const files = [...publicTemplates(), ...PAGE_SCRIPTS];
    expect(files.length, 'expected the public templates').toBeGreaterThan(5);
    const findings = files.flatMap((rel) => templateFindings(read(rel), rel));
    expect(findings).toEqual([]);
  });
});

// ── 6: each rule fails on an injected coordinate ─────────────────────────────

test.describe('OSE-2197 | the gate fails on an injected coordinate', () => {
  test('6a. a coordinate or a res-9 cell put back in the projection is reported', () => {
    const src = read(PROJECTION);
    const at = "  'corridor_id',\n";
    expect(src.includes(at), 'the injection point moved').toBe(true);
    for (const field of ['lat', 'lon', 'latitude', 'venue_lng', 'h3_res9']) {
      expect(projectionFindings(src.replace(at, `  '${field}',\n${at}`)), field).not.toEqual([]);
    }
  });

  test('6b. a coordinate on the map item or in its SELECT is reported', () => {
    const src = read(MAP_READ);
    const item = '      h3_res7: cell,\n';
    expect(src.includes(item), 'the injection point moved').toBe(true);
    expect(mapReadFindings(src.replace(item, `${item}      lat: e.lat,\n`))).not.toEqual([]);
    expect(
      mapReadFindings(src.replace('              h3_res7\n', '              lat, lon, h3_res7\n'))
    ).not.toEqual([]);
  });

  test('6c. a coordinate in a public response builder is reported', () => {
    const body = functionBody(read('handlers/events.ts'), FUNCTION_BUILDERS[1]![1], 'events.ts');
    expect(builderFindings(body, 'read')).toEqual([]);
    const injected = body.replace('series,\n', 'series,\n        lat: row.lat,\n');
    expect(injected).not.toBe(body);
    expect(builderFindings(injected, 'read')).not.toEqual([]);
    expect(builderFindings('const x = { coordinates: [1, 2] };', 'any')).not.toEqual([]);
    // Unnamed: a row spread into the answer, or every column selected.
    const spread = body.replace('series,\n', 'series,\n        ...row,\n');
    expect(spread).not.toBe(body);
    expect(builderFindings(spread, 'read')).toEqual(['read spreads a row']);
    expect(builderFindings('db.prepare(`SELECT * FROM events WHERE id = ?`)', 'any')).toEqual([
      'any selects every column',
    ]);
    expect(builderFindings('db.prepare(`SELECT e.* FROM events e`)', 'any')).toEqual([
      'any selects every column',
    ]);
  });

  test('6d. a zoomed dot placed from a point is reported', () => {
    const src = read(ZOOM);
    const at = '    const block = blockOf(e.h3_res9);\n';
    expect(src.includes(at), 'the injection point moved').toBe(true);
    const fromPoint = src.replace(at, '    const block = latLngToCell(e.lat as number, 0, 9);\n');
    expect(zoomFindings(fromPoint)).not.toEqual([]);
    // Each sub-rule on its own: a read of the point, a destructured point, a
    // cell derived from a point that was not read from the event.
    const readOnly = src.replace(at, `${at}    void e.lon;\n`);
    expect(zoomFindings(readOnly)).toEqual(["mapDots reads an event's coordinate"]);
    const destructured = src.replace(at, `${at}    const { lat } = e as { lat?: number };\n`);
    expect(zoomFindings(destructured)).toEqual(["mapDots destructures an event's coordinate"]);
    const derived = src.replace(at, '    const block = latLngToCell(41.6, -87.6, 9);\n');
    expect(zoomFindings(derived)).toEqual(['mapDots derives a cell from a point']);
    const shapeAt = 'export interface ZoomEvent extends AttendeeMapItem {\n';
    expect(src.includes(shapeAt), 'the injection point moved').toBe(true);
    expect(zoomFindings(src.replace(shapeAt, `${shapeAt}  lat?: unknown;\n`))).not.toEqual([]);
  });

  test("6e. a template that reads an event's coordinate is reported; the visitor's own position is not", () => {
    const page = read('templates/display.html');
    expect(templateFindings(page, 'display')).toEqual([]);
    for (const fault of [
      '<script>var at = item.lat;</script>',
      '<script>var at = ev["longitude"];</script>',
      '<div data-lat="41.657"></div>',
    ]) {
      expect(templateFindings(page + fault, 'display'), fault).not.toEqual([]);
    }
    const own = '<script>go(p.coords.latitude, p.coords.longitude);</script>';
    expect(templateFindings(page + own, 'display')).toEqual([]);
  });
});

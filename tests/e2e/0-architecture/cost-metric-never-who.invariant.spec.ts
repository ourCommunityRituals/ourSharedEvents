/**
 * INVARIANT: Cost metric is aggregate-only / never-who (COST-301 / OSE-780).
 *
 * The per-operation cost metric (src/lib/cost-metric.ts) exists to make runtime
 * cost visible as it scales toward the 100× D1/BigQuery watch-item. It must NOT
 * become a privacy hole: the emitted payload can only ever carry aggregate
 * numbers plus a keyword-masked operation label. No user identifier, IP, email,
 * anon-id, token, actor, or raw path segment may appear.
 *
 * This is the S0/S2 wall for the metric. It is a STRUCTURAL invariant (reads
 * source via node:fs, no deployed worker) so it runs on every PR/push in the
 * T0 gate — it must be listed in the "Architecture: structural invariants"
 * step of .github/workflows/oursharedevents-ci.yml (enforced by
 * tests/integration/infra-consistency.test.js).
 *
 * Pattern reference: aggregate-only.invariant.spec.ts (same readFileSync
 * L0 structural approach using Playwright with Node fs access).
 *
 * What this catches:
 *   - A field added to the OperationCostMetric payload that is not one of the
 *     sealed aggregate keys → key-set assertion fails.
 *   - An identifier token (email/ip/anon_id/actor/token/...) introduced into the
 *     payload interface or the emitter body → forbidden-token assertion fails.
 *   - The metric emission being unwired from the request seam in index.ts →
 *     wiring assertion fails.
 *
 * THE STREET_LAYER LINE (street-map CCR 2026-11-15, R4) is held to the same
 * shape, in the second block below. The street layer writes one line for each
 * try that reads its bucket (src/lib/street-map.ts, `emitStreetLayer`): what
 * came of it, on which surface, and five numbers. The street layer knows which
 * cells a page drew and which tiles it read, so its line must be never-where as
 * well as never-who: a cell or a tile address in Workers Logs would say which
 * part of the map a request showed. This catches a key added to the line, a
 * place- or identifier-shaped word in the line or its emitter, a second
 * console call in the street layer, a console call in the archive reader or
 * the tile decoder, and the loader no longer writing the line.
 *
 * @born-red the STREET_LAYER line | method: nine faults in
 *   workers/oursharedevents/src/lib, one at a time, each seen failing the test
 *   named and put back: `cells: string[]` added to StreetLayerLine ("carries
 *   only the sealed keys" and "no place or identifier words"); `cells:` added
 *   to the payload literal ("exactly the sealed keys" and "no place or
 *   identifier words"); the trace spread into the payload ("exactly the sealed
 *   keys"); a comment naming a tile and a cell in the emitter body ("no place
 *   or identifier words"); `console.log(z, tiles)` added to readTiles in
 *   pmtiles.ts, a `console.warn` of the cells added to loadStreetLayer, a
 *   `console.error` added to mvt.ts, and the line written with the input as a
 *   second argument ("one sink", each); the emitStreetLayer call removed from
 *   loadStreetLayer ("the loader writes the line") | date: 2026-11-15
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const COST_METRIC_PATH = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'cost-metric.ts'
);
const INDEX_PATH = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'index.ts');
const LIB_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'lib');
const STREET_MAP_PATH = join(LIB_DIR, 'street-map.ts');

// The complete, sealed set of keys the STREET_LAYER line may carry.
const STREET_LINE_KEYS = ['type', 'outcome', 'surface', 'z', 'tiles', 'r2Reads', 'ms'].sort();

// Place-shaped words that must never appear in the line or its emitter: any of
// them in Workers Logs would say which part of the map a request showed.
const FORBIDDEN_PLACE_TOKENS = [
  'cell',
  'cells',
  'cellsKey',
  'h3',
  'lat',
  'lng',
  'lon',
  'x',
  'y',
  'tile',
  'offset',
  'key',
  'name',
  'archive',
  'url',
  'request',
  'env',
  'numbered',
  'svg',
  'message',
];

// The complete, sealed set of keys the metric payload may carry. Adding a key
// here is a deliberate act that must be reviewed against the never-who wall.
const ALLOWED_PAYLOAD_KEYS = [
  'type',
  'op',
  'wallMs',
  'd1RowsRead',
  'd1RowsWritten',
  'd1Queries',
  'status',
].sort();

// Identifier-shaped tokens that must never appear in the payload interface or
// the emitter body. Word-boundary matched to avoid false positives.
const FORBIDDEN_IDENTIFIER_TOKENS = [
  'email',
  'anon_id',
  'anonId',
  'ip',
  'actor',
  'userId',
  'user_id',
  'phone',
  'cookie',
  'authorization',
  'password',
  'secret',
  'pepper',
  'token',
  'slug',
  'pathname',
];

function extractKeys(body: string): string[] {
  // Pull identifier-like keys from an interface body or object literal:
  // matches `foo:` at a line start (interface) or `foo:` in a literal.
  const keys = new Set<string>();
  const re = /(^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    keys.add(m[2]);
  }
  return [...keys].sort();
}

test.describe('Invariant: cost metric never-who — structural code-shape lock', () => {
  test('OSE-COST301 | privacy | existence | cost-metric.ts exists', () => {
    expect(
      existsSync(COST_METRIC_PATH),
      'workers/oursharedevents/src/lib/cost-metric.ts must exist — deleting it removes ' +
        'the aggregate-only cost metric and its never-who guarantee'
    ).toBe(true);
  });

  test('OSE-COST301 | privacy | payload | OperationCostMetric carries only sealed aggregate keys', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    const ifaceMatch = src.match(/export\s+interface\s+OperationCostMetric\s*\{([\s\S]*?)\n\}/);
    expect(
      ifaceMatch,
      'OperationCostMetric interface must be defined and exported from cost-metric.ts'
    ).not.toBeNull();
    const keys = extractKeys(ifaceMatch![1]);
    expect(
      keys,
      `OperationCostMetric has unexpected fields. Only aggregate, non-identifying keys are ` +
        `permitted (${ALLOWED_PAYLOAD_KEYS.join(', ')}). A new key here must be reviewed ` +
        `against the never-who wall.`
    ).toEqual(ALLOWED_PAYLOAD_KEYS);
  });

  test('OSE-COST301 | privacy | emitter | emitted payload literal has exactly the sealed keys', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    // The literal assigned inside emitOperationCost: `const payload: ... = { ... };`
    const literalMatch = src.match(
      /const\s+payload\s*:\s*OperationCostMetric\s*=\s*\{([\s\S]*?)\n\s*\};/
    );
    expect(
      literalMatch,
      'emitOperationCost must build the payload as an explicit `const payload: OperationCostMetric = {...}` ' +
        'literal — this is the structural never-who guarantee (only allowlisted fields are emitted)'
    ).not.toBeNull();
    const keys = extractKeys(literalMatch![1]);
    expect(
      keys,
      'the emitted payload literal must contain exactly the sealed aggregate keys and nothing else'
    ).toEqual(ALLOWED_PAYLOAD_KEYS);
  });

  test('OSE-COST301 | privacy | no-identifiers | payload interface + emitter body carry no identifier tokens', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    const ifaceMatch = src.match(/export\s+interface\s+OperationCostMetric\s*\{([\s\S]*?)\n\}/);
    const emitMatch = src.match(/export\s+function\s+emitOperationCost[\s\S]*?\n\}/);
    const guarded = `${ifaceMatch ? ifaceMatch[1] : ''}\n${emitMatch ? emitMatch[0] : ''}`;
    for (const tok of FORBIDDEN_IDENTIFIER_TOKENS) {
      const re = new RegExp(`\\b${tok}\\b`, 'i');
      expect(
        re.test(guarded),
        `identifier token "${tok}" appears in the cost-metric payload interface or emitter body — ` +
          `the metric must be aggregate-only / never-who. If this is a false positive, narrow the region.`
      ).toBe(false);
    }
  });

  test('OSE-COST301 | privacy | masking | operation label masks non-keyword segments to :x', () => {
    const src = readFileSync(COST_METRIC_PATH, 'utf8');
    // normalizeOperation must mask unknown segments — the guarantee that an
    // event slug / QR token / id can never surface as a label. Lock the masking
    // sentinel and the STATIC_SEGMENTS allowlist mechanism structurally; the
    // behavioral proof lives in the unit test.
    expect(
      src,
      'normalizeOperation must exist to derive an identifier-free operation label'
    ).toMatch(/export\s+function\s+normalizeOperation\s*\(/);
    expect(src, 'the label must mask non-keyword path segments to the ":x" sentinel').toMatch(
      /':x'/
    );
    expect(
      src,
      'masking must be an allowlist (STATIC_SEGMENTS.has(...)) so the DEFAULT is to mask — ' +
        'a segment is only kept if it is a known keyword'
    ).toMatch(/STATIC_SEGMENTS\.has\s*\(/);
  });

  test('OSE-COST301 | wiring | index.ts emits the cost metric at the request seam', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    expect(
      src,
      'index.ts must import the cost-metric emitter — the request seam is where the metric is emitted'
    ).toMatch(/from\s+'\.\/lib\/cost-metric'/);
    expect(
      src,
      'index.ts must call emitOperationCost(...) once per request so the metric is actually emitted'
    ).toMatch(/emitOperationCost\s*\(/);
    expect(
      src,
      'index.ts must instrument the D1 bindings via instrumentEnvForCost(...) so D1 rows are counted'
    ).toMatch(/instrumentEnvForCost\s*\(/);
  });
});

test.describe('Invariant: the STREET_LAYER line never-who, never-where — structural code-shape lock', () => {
  const streetSrc = (): string => readFileSync(STREET_MAP_PATH, 'utf8');
  const lineInterface = (src: string) =>
    src.match(/export\s+interface\s+StreetLayerLine\s*\{([\s\S]*?)\n\}/);
  const emitter = (src: string) => src.match(/export\s+function\s+emitStreetLayer[\s\S]*?\n\}/);
  /** Console calls in a source file, comments left out. */
  const consoleCalls = (file: string): number => {
    const code = readFileSync(join(LIB_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    return (code.match(/\bconsole\s*\.\s*[a-z]+\s*\(/g) ?? []).length;
  };

  test('STREET-LAYER | privacy | payload | StreetLayerLine carries only the sealed keys', () => {
    const iface = lineInterface(streetSrc());
    expect(iface, 'StreetLayerLine must be defined and exported from street-map.ts').not.toBeNull();
    expect(
      extractKeys(iface![1]),
      `StreetLayerLine has unexpected fields. Only an outcome, a surface and numbers are ` +
        `permitted (${STREET_LINE_KEYS.join(', ')}). A new key must be reviewed against ` +
        `never who and place-not-person: no cell, no tile address, nothing of the request.`
    ).toEqual(STREET_LINE_KEYS);
  });

  test('STREET-LAYER | privacy | emitter | the emitted payload literal has exactly the sealed keys', () => {
    const literal = streetSrc().match(
      /const\s+payload\s*:\s*StreetLayerLine\s*=\s*\{([\s\S]*?)\n\s*\};/
    );
    expect(
      literal,
      'emitStreetLayer must build the line as an explicit `const payload: StreetLayerLine = {...}` ' +
        'literal, key by key, so nothing a caller holds can ride along'
    ).not.toBeNull();
    expect(
      literal![1],
      'the payload literal may not spread another object into the line'
    ).not.toMatch(/\.\.\./);
    expect(
      extractKeys(literal![1]),
      'the emitted payload literal must contain exactly the sealed keys and nothing else'
    ).toEqual(STREET_LINE_KEYS);
  });

  test('STREET-LAYER | privacy | no-identifiers | the line and its emitter carry no place or identifier words', () => {
    const src = streetSrc();
    const iface = lineInterface(src);
    const emit = emitter(src);
    expect(emit, 'emitStreetLayer must be defined and exported from street-map.ts').not.toBeNull();
    const guarded = `${iface ? iface[1] : ''}\n${emit ? emit[0] : ''}`;
    for (const tok of [...FORBIDDEN_IDENTIFIER_TOKENS, ...FORBIDDEN_PLACE_TOKENS]) {
      const re = new RegExp(`\\b${tok}\\b`, 'i');
      expect(
        re.test(guarded),
        `"${tok}" appears in the STREET_LAYER line or its emitter. The line says what a try at ` +
          `the street layer came to, never where and never for whom.`
      ).toBe(false);
    }
  });

  test('STREET-LAYER | privacy | one sink | one console call in the street layer, none in the reader or the decoder', () => {
    expect(
      emitter(streetSrc())?.[0] ?? '',
      'the one console call is the line, written whole by emitStreetLayer'
    ).toMatch(/console\.log\(JSON\.stringify\(payload\)\)/);
    expect(
      consoleCalls('street-map.ts'),
      'street-map.ts may write to the log in one place only, emitStreetLayer: the file holds ' +
        'the cells and the tiles of the page it draws'
    ).toBe(1);
    for (const file of ['pmtiles.ts', 'mvt.ts']) {
      expect(
        consoleCalls(file),
        `${file} must not write to the log: it holds tile addresses and byte ranges, and a ` +
          `logged tile range says which part of the map a page showed`
      ).toBe(0);
    }
  });

  test('STREET-LAYER | wiring | the loader writes the line', () => {
    const loader = streetSrc().match(/export\s+async\s+function\s+loadStreetLayer[\s\S]*?\n\}/);
    expect(loader, 'loadStreetLayer must be defined in street-map.ts').not.toBeNull();
    expect(
      loader![0],
      'loadStreetLayer must call emitStreetLayer(...): without it a street layer that fell ' +
        'back to hexagons says nothing about why'
    ).toMatch(/emitStreetLayer\s*\(/);
  });
});

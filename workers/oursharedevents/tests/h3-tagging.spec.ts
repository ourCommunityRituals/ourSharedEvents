/**
 * H3 NCR tagging + corridor map spec (S-6.1.1 / S-6.3.1a / S-6.3.1c)
 *
 * Three sections:
 *   A. h3-tagging.ts unit tests — Eagles Hall ground truth + edge cases (5 tests)
 *   B. corridor-map.ts unit tests — honesty at any density + privacy floor (6 tests)
 *   C. Hot-path guard — scan handlers import neither h3-js nor h3-tagging (S-6.3.1c)
 *
 * Runs under @cloudflare/vitest-pool-workers. Parts A+B import pure TypeScript;
 * part C uses TEST_SOURCE_FILES_JSON (same as architecture.spec.ts).
 */

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { gridRingUnsafe } from 'h3-js';
import { tagCoordinates, tagsConsistent, maybeTag } from '../src/lib/h3-tagging';
import { renderCorridorMap } from '../src/lib/corridor-map';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;
const norm = (p: string) => p.replace(/\\/g, '/');

function getSource(suffix: string): string {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  for (const [path, content] of Object.entries(sources)) {
    if (norm(path).endsWith(suffix)) return content;
  }
  throw new Error(`[h3-hot-path] expected source file ending in "${suffix}" not found`);
}

// Known venue coordinates (Eagles Hall, Blue Island IL)
const EAGLES = { lat: 41.6571, lon: -87.6798 };
const RIPH = { lat: 41.6565, lon: -87.681 }; // Rock Island Public House — blocks away

// ─── A. h3-tagging.ts ─────────────────────────────────────────────────────────

describe('A. h3-tagging — Eagles Hall ground truth', () => {
  it('tags to canonical NCR cells and is consistent', () => {
    const t = tagCoordinates(EAGLES.lat, EAGLES.lon);
    expect(t.h3_res9).toBe('89266454447ffff');
    expect(t.h3_res7).toBe('872664544ffffff');
    expect(tagsConsistent(t)).toBe(true);
  });

  it('invalid coordinates fail loudly at creation time', () => {
    expect(() => tagCoordinates(999, 0)).toThrow();
    expect(() => tagCoordinates(Number.NaN, -87)).toThrow();
    expect(() => tagCoordinates(41, 999)).toThrow();
  });

  it('null coordinates return null (maybeTag — update path)', () => {
    expect(maybeTag(null, -87.68)).toBeNull();
    expect(maybeTag(41.65, null)).toBeNull();
    expect(maybeTag(null, null)).toBeNull();
  });

  it('corrupted stored tags are caught by the consistency check', () => {
    // res9 valid but wrong res7 parent
    expect(tagsConsistent({ h3_res9: '89266454447ffff', h3_res7: '8726645ddffffff' })).toBe(false);
    // res9 is nonsense
    expect(tagsConsistent({ h3_res9: 'nonsense', h3_res7: '872664544ffffff' })).toBe(false);
  });

  it('two nearby venues share the same corridor cell (res7) but differ at res9', () => {
    const a = tagCoordinates(EAGLES.lat, EAGLES.lon);
    const b = tagCoordinates(RIPH.lat, RIPH.lon);
    expect(a.h3_res9).not.toBe(b.h3_res9);
    // They're within the same ~5km corridor
    expect(a.h3_res7).toBe(b.h3_res7);
  });
});

// ─── B. corridor-map.ts ───────────────────────────────────────────────────────

describe('B. corridor-map — honesty at any density', () => {
  it('day-one honesty: one venue renders one real hexagon with correct count', () => {
    const { svg, rendered, suppressed } = renderCorridorMap([
      { cell: '89266454447ffff', count: 42, label: 'Eagles Hall' },
    ]);
    expect(rendered).toBe(1);
    expect(suppressed.length).toBe(0);
    expect(svg).toMatch(/data-testid="hex-cell"/);
    expect(svg).toMatch(/data-count="42"/);
    expect(svg).toMatch(/Eagles Hall — 42 scans/);
    expect(svg).not.toMatch(/NaN/);
  });

  it('privacy floor: cells under K render suppressed — suppressed counts NEVER serialized', () => {
    const { rendered, suppressed, svg } = renderCorridorMap(
      [
        { cell: '89266454447ffff', count: 42 },
        { cell: tagCoordinates(RIPH.lat, RIPH.lon).h3_res9, count: 3 },
      ],
      { minCount: 5 }
    );
    expect(rendered).toBe(1);
    expect(suppressed.length).toBe(1);
    expect(svg).toMatch(/data-testid="hex-suppressed"/);
    expect(svg).toMatch(/below reporting floor/);
    // Critical: suppressed count must never appear in the SVG output
    expect(svg).not.toMatch(/data-count="3"/);
  });

  it('corridor + ring: res7 cell with gridRing neighbors renders as a real corridor view', () => {
    const t = tagCoordinates(EAGLES.lat, EAGLES.lon);
    const ring = gridRingUnsafe(t.h3_res7, 1);
    const cells = [{ cell: t.h3_res7, count: 42 }, ...ring.map((c) => ({ cell: c, count: 0 }))];
    const { rendered, suppressed } = renderCorridorMap(cells, { minCount: 5 });
    expect(rendered).toBe(1); // only the active corridor cell counted
    expect(suppressed.length).toBe(6); // ring neighbors present but suppressed
  });

  it('empty data renders the honest empty state, never a broken map', () => {
    const { svg, rendered } = renderCorridorMap([]);
    expect(rendered).toBe(0);
    expect(svg).toMatch(/corridor-map-empty/);
    expect(svg).toMatch(/accumulates with each event/);
  });

  it('XSS: hostile venue labels are escaped in SVG titles', () => {
    const { svg } = renderCorridorMap([
      { cell: '89266454447ffff', count: 42, label: '<script>alert(1)</script>' },
    ]);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('invalid H3 cell IDs are silently filtered — no broken geometry', () => {
    const { svg, rendered } = renderCorridorMap([
      { cell: 'not-a-valid-cell', count: 99 },
      { cell: '89266454447ffff', count: 10 },
    ]);
    expect(rendered).toBe(1); // only the valid cell
    expect(svg).not.toMatch(/NaN/);
  });
});

// ─── C. Hot-path guard (S-6.3.1c) ────────────────────────────────────────────
// Scan-path handlers must NEVER import h3-js or h3-tagging — geo enrichment
// is creation-time only. Same pattern as tier-equity scan-path guard.

const H3_HOT_PATH_PATTERN = /h3-js|h3-tagging/;

const SCAN_PATH = [
  'src/handlers/qr-verify.ts',
  'src/handlers/shortlink-resolve.ts',
  'src/handlers/uec-resolve.ts',
  'src/handlers/forms.ts',
  'src/lib/shared-report-builder.ts',
] as const;

describe('C. hot-path guard — scan handlers import no H3 geo code', () => {
  for (const relPath of SCAN_PATH) {
    it(`${relPath} does not import h3-js or h3-tagging`, () => {
      const src = getSource(relPath);
      const match = src.match(H3_HOT_PATH_PATTERN);
      expect(match, `found H3 import in hot-path file ${relPath}: "${match?.[0]}"`).toBeNull();
    });
  }
});

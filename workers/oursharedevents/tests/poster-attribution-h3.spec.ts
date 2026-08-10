/**
 * OSE-630 | INT-02 — h3_res9 in poster_attribution table gate
 *
 * Source-level gates asserting that shared-report.html renders the h3_res9
 * field from poster_attribution rows in the Poster Attribution table:
 *
 *   1. Table header includes "Cell (res9)" column
 *   2. Row cells reference p.h3_res9 with the correct testid
 *   3. Null guard: "—" shown when h3_res9 is absent
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function getTemplate(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('templates/shared-report.html')
  );
  if (!entry) throw new Error('shared-report.html not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

describe('OSE-630 | INT-02 | poster_attribution h3_res9 column gate', () => {
  test('Poster Attribution table header includes Cell (res9) column', () => {
    const src = getTemplate();
    expect(src).toContain('Cell (res9)');
  });

  test('poster row cells render h3_res9 with poster-row-h3-res9 testid', () => {
    const src = getTemplate();
    expect(src).toContain('data-testid="poster-row-h3-res9"');
    expect(src).toContain('p.h3_res9');
  });

  test('null guard renders em-dash when h3_res9 is absent', () => {
    const src = getTemplate();
    // Pattern: (p.h3_res9 ? esc(p.h3_res9) : '—')
    expect(src).toMatch(/p\.h3_res9\s*\?.*esc\(p\.h3_res9\).*:\s*'—'/s);
  });
});

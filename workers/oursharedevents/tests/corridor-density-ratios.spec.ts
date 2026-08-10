/**
 * OSE-629 | INT-11 — Density ratio rendering gate
 *
 * Source-level gates asserting that shared-report.html wires up both density
 * ratio fields from the SharedReport API response:
 *
 *   - density_ratio_30d → data-testid="corridor-density-ratio-30d"
 *   - density_ratio_90d → data-testid="corridor-density-ratio-90d"
 *   - fmtRatio helper is defined and used for both fields
 *   - Corridor Scans count testid present (renamed from generic label)
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

describe('OSE-629 | INT-11 | density ratio rendering gate', () => {
  test('fmtRatio helper is defined in signed-link script', () => {
    const src = getTemplate();
    expect(src).toContain('fmtRatio');
    expect(src).toMatch(/const fmtRatio\s*=/);
  });

  test('fmtRatio formats null as em-dash', () => {
    const src = getTemplate();
    // The helper must handle null gracefully.
    expect(src).toMatch(/fmtRatio\s*=\s*\(n\)\s*=>\s*\(n == null/);
  });

  test('density_ratio_30d is rendered with corridor-density-ratio-30d testid', () => {
    const src = getTemplate();
    expect(src).toContain('data-testid="corridor-density-ratio-30d"');
    expect(src).toContain('density_ratio_30d');
  });

  test('density_ratio_90d is rendered with corridor-density-ratio-90d testid', () => {
    const src = getTemplate();
    expect(src).toContain('data-testid="corridor-density-ratio-90d"');
    expect(src).toContain('density_ratio_90d');
  });

  test('fmtRatio is called for both ratio fields', () => {
    const src = getTemplate();
    expect(src).toMatch(/fmtRatio\(.*density_ratio_30d/);
    expect(src).toMatch(/fmtRatio\(.*density_ratio_90d/);
  });

  test('corridor-density-count testid present for scan count', () => {
    const src = getTemplate();
    expect(src).toContain('data-testid="corridor-density-count"');
  });
});

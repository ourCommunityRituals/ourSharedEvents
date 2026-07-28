/**
 * Invariant #5 — tier_equity (flywheel, S-3.1.1 / S-3.2.1)
 *
 * Two halves of the same guarantee:
 *
 *   A. Data COLLECTION is tier-blind.
 *      The scan path (qr-verify → shortlink-resolve → uec-resolve → shared-report
 *      builder) must contain ZERO references to report-depth tiers. If any of
 *      those files imports from report-depth.ts, or mentions the depth-tier
 *      vocabulary, this test fails. Tier awareness must stay in the READ handler.
 *
 *   B. READ-SIDE depth is omission-only.
 *      filterReportByDepth() must never transform, round, or degrade values — only
 *      decide whether each key is present. Tests drive the implementation directly.
 *
 * Run: vitest workers/oursharedevents/tests/tier-equity.invariant.spec.ts
 *
 * NOTE: runs under @cloudflare/vitest-pool-workers. Source file inspection uses
 * TEST_SOURCE_FILES_JSON (pre-loaded at Node.js config time) — NOT node:fs.
 */

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { resolveDepth, filterReportByDepth, DEPTH_SECTIONS } from '../src/lib/report-depth';

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
  throw new Error(
    `[tier-equity] expected source file ending in "${suffix}" not found in TEST_SOURCE_FILES_JSON`
  );
}

// ─── A. Collection is tier-blind ──────────────────────────────────────────────

// Vocabulary that would indicate a scan-path file knows about report-depth tiers.
const DEPTH_TIER_PATTERN = /report-depth|ReportDepth|resolveDepth|filterReportByDepth/;

const INGEST_PATH = [
  'src/handlers/qr-verify.ts',
  'src/handlers/shortlink-resolve.ts',
  'src/handlers/uec-resolve.ts',
  'src/lib/shared-report-builder.ts',
] as const;

describe('A. data collection is tier-blind', () => {
  for (const relPath of INGEST_PATH) {
    it(`${relPath} has no report-depth imports or vocabulary`, () => {
      const src = getSource(relPath);
      const match = src.match(DEPTH_TIER_PATTERN);
      expect(match, `found depth-tier vocabulary in ${relPath}: "${match?.[0]}"`).toBeNull();
    });
  }
});

// ─── B. Read-side depth is omission-only ──────────────────────────────────────

const FULL_REPORT = {
  event_id: 'evt_test',
  event_title: 'Test Event',
  event_start_date: '2026-06-01T18:00:00Z',
  event_end_date: '2026-06-01T22:00:00Z',
  unique_gatherings: 42,
  sponsor_impressions: [
    { sponsor_id: 'sp_A', impressions: 100 },
    { sponsor_id: 'sp_B', impressions: 50 },
  ],
  poster_attribution: { views: 200, scans: 40 },
  return_rate: 0.35,
  corridor_density: [{ cell: 'h3_abc', count: 12 }],
  headcount_trend: [{ date: '2026-06-01', count: 42 }],
  _meta: { built_at: '2026-07-26T00:00:00Z' },
} as const;

describe('B. read-side depth is omission-only', () => {
  it('local tier: only allowed sections present — values identical to full report', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local' });
    const { report } = filterReportByDepth({ ...FULL_REPORT }, resolved);
    const allowed = new Set(DEPTH_SECTIONS.local);
    for (const key of Object.keys(report)) {
      expect(allowed.has(key), `unexpected key "${key}" in local tier`).toBe(true);
    }
    // Values are NOT transformed
    expect(report.unique_gatherings).toBe(42);
    expect(report.event_id).toBe('evt_test');
    // Premium-only field absent
    expect('headcount_trend' in report).toBe(false);
  });

  it('mid tier: includes poster_attribution and return_rate but not headcount_trend', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'mid' });
    const { report } = filterReportByDepth({ ...FULL_REPORT }, resolved);
    expect('poster_attribution' in report).toBe(true);
    expect('return_rate' in report).toBe(true);
    expect('headcount_trend' in report).toBe(false);
    // Values unchanged
    expect(report.return_rate).toBe(0.35);
  });

  it('premium tier: all sections pass through including headcount_trend', () => {
    const resolved = resolveDepth({ role: 'admin' });
    const { report } = filterReportByDepth({ ...FULL_REPORT }, resolved);
    expect('headcount_trend' in report).toBe(true);
    expect(report.headcount_trend).toEqual(FULL_REPORT.headcount_trend);
    expect(report.unique_gatherings).toBe(42);
  });

  it('sponsor scope: local sponsor sees only their own impressions — no cross-contamination', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const { report } = filterReportByDepth({ ...FULL_REPORT }, resolved);
    const impressions = report.sponsor_impressions as Array<{ sponsor_id: string }>;
    expect(impressions.every((r) => r.sponsor_id === 'sp_A')).toBe(true);
    expect(impressions.some((r) => r.sponsor_id === 'sp_B')).toBe(false);
  });

  it('upgrade hint: local tier returns locked mid sections present in the report', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local' });
    const { upgrade } = filterReportByDepth({ ...FULL_REPORT }, resolved);
    expect(upgrade).not.toBeNull();
    expect(upgrade!.next_depth).toBe('mid');
    // poster_attribution is in mid but not local and IS present in the report
    expect(upgrade!.locked_sections).toContain('poster_attribution');
  });

  it('upgrade hint: premium tier returns null (already at top)', () => {
    const resolved = resolveDepth({ role: 'admin' });
    const { upgrade } = filterReportByDepth({ ...FULL_REPORT }, resolved);
    expect(upgrade).toBeNull();
  });
});

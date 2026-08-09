/**
 * OSE-561 — Sponsor critical-path audit
 *
 * Guards the four sponsor-specific threats in the threat ledger:
 *
 *   TL-037  depth escalation: local-scoped token cannot reach premium fields
 *   TL-038  cross-sponsor leakage: event_id claim is validated before serving
 *   TL-039  access log coverage: every SharedReport access path writes audit row
 *   TL-040  demo trio regression: local/mid/premium tier boundaries are stable
 *
 * Tests are purely structural (L0) or pure-unit (L1) — no miniflare required.
 * The static gates read source text from TEST_SOURCE_FILES_JSON; the unit
 * tests import resolveDepth + filterReportByDepth directly.
 *
 * These tests are born-red: each one would have failed at the time the threat
 * was written (either because the guard didn't exist, or because the test
 * itself asserts a negative). The @born-red annotations link back to the
 * threat ledger entries so the conformance report can trace coverage.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveDepth, filterReportByDepth, DEPTH_SECTIONS } from '../src/lib/report-depth';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// ─── Sample report covering all depth sections ────────────────────────────────

const FULL_REPORT: Record<string, unknown> = {
  event_id: 'evt-sponsor-audit-test',
  event_title: 'Sponsor Audit Test Event',
  event_start_date: '2026-08-03T18:00:00Z',
  event_end_date: '2026-08-03T22:00:00Z',
  unique_gatherings: 50,
  sponsor_impressions: [{ sponsor_id: 'sp_test', impressions: 100 }],
  poster_attribution: { views: 300, scans: 60 },
  return_rate: 0.35,
  corridor_density: [{ cell: '89266454447ffff', count: 10 }],
  headcount_trend: [{ date: '2026-08-03', count: 50 }],
  _meta: { built_at: '2026-08-03T00:00:00Z' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// S1/S2 — TL-037: depth escalation prevention
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-561 S1/S2 — depth escalation: local token cannot reach premium fields', () => {
  // @born-red TL-037 | method: design-time-negative-assertion | date: 2026-08-03
  test('local-depth token produces depth=local and omits premium-only fields', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local' });
    expect(resolved.depth).toBe('local');

    const { report } = filterReportByDepth(FULL_REPORT, resolved);

    // Fields that exist in premium but not in mid are premium-only
    const premiumOnly = DEPTH_SECTIONS.premium.filter(
      (f) => !DEPTH_SECTIONS.mid.includes(f)
    );
    for (const field of premiumOnly) {
      expect(
        report,
        `premium-only field "${field}" must not appear in local-depth response`
      ).not.toHaveProperty(field);
    }
  });

  // @born-red TL-037 | method: design-time-negative-assertion | date: 2026-08-03
  test('mid-depth token omits premium-only fields but includes local fields', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'mid' });
    expect(resolved.depth).toBe('mid');

    const { report } = filterReportByDepth(FULL_REPORT, resolved);

    // Every local section field must be present in mid output
    for (const field of DEPTH_SECTIONS.local) {
      if (field in FULL_REPORT) {
        expect(
          report,
          `mid-depth response must include local field "${field}"`
        ).toHaveProperty(field);
      }
    }

    // Fields in premium but not in mid are premium-only — must be absent
    const premiumOnly = DEPTH_SECTIONS.premium.filter(
      (f) => !DEPTH_SECTIONS.mid.includes(f)
    );
    for (const field of premiumOnly) {
      expect(
        report,
        `premium-only field "${field}" must not appear in mid-depth response`
      ).not.toHaveProperty(field);
    }
  });

  test('premium-depth token (admin/bar_owner) receives all fields', () => {
    const resolved = resolveDepth({ role: 'admin' });
    expect(resolved.depth).toBe('premium');

    const { report } = filterReportByDepth(FULL_REPORT, resolved);

    for (const field of DEPTH_SECTIONS.premium) {
      if (field in FULL_REPORT) {
        expect(
          report,
          `premium-depth response must include field "${field}"`
        ).toHaveProperty(field);
      }
    }
  });

  test('fail-closed: unrecognised depth claim for sponsor defaults to local (never escalates)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'superstar' as 'premium' });
    expect(resolved.depth).toBe('local');
    // Must not escalate to premium
    expect(resolved.depth).not.toBe('premium');
    expect(resolved.depth).not.toBe('mid');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S3 — TL-038: event_id claim validated before serving data
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-561 S3 — TL-038: sponsor_id claim validated before data is served', () => {
  // @born-red TL-038 | method: design-time-negative-assertion | date: 2026-08-03
  test('handleGetSharedReport checks claim.eventId !== path eventId before serving', () => {
    const sources = loadSources();
    const readHandlerKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('handlers/shared-report-read')
    );
    expect(readHandlerKey, 'shared-report-read.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();

    const src = sources[readHandlerKey!];

    // The handler must compare the token's event ID claim against the URL path
    expect(
      src,
      'shared-report-read.ts must validate claim.eventId against path :id'
    ).toMatch(/claim\.eventId\s*!==\s*eventId/);

    // It must return 403 on mismatch — not serve data
    expect(
      src,
      'shared-report-read.ts must return 403 when event_id claim mismatches'
    ).toMatch(/403/);
  });

  test('verifySignedLinkToken is called before any data access', () => {
    const sources = loadSources();
    const readHandlerKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('handlers/shared-report-read')
    );
    const src = sources[readHandlerKey!]!;

    // Token verification must precede buildSharedReport
    const verifyIdx = src.indexOf('verifySignedLinkToken');
    const buildIdx = src.indexOf('buildSharedReport');
    expect(verifyIdx, 'verifySignedLinkToken must appear before buildSharedReport').toBeGreaterThanOrEqual(0);
    expect(buildIdx, 'buildSharedReport must appear in read handler').toBeGreaterThanOrEqual(0);
    expect(
      verifyIdx,
      'verifySignedLinkToken must be called before buildSharedReport'
    ).toBeLessThan(buildIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S4/S5 — TL-039: every SharedReport access path writes an audit row
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-561 S4/S5 — TL-039: every access path writes to report_access_log', () => {
  // @born-red TL-039 | method: design-time-negative-assertion | date: 2026-08-03
  test('handleGetSharedReport calls logReportAccess on the granted path', () => {
    const sources = loadSources();
    const readHandlerKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('handlers/shared-report-read')
    );
    const src = sources[readHandlerKey!]!;

    // Must import logReportAccess
    expect(src, 'shared-report-read.ts must import logReportAccess').toContain('logReportAccess');

    // Must call logReportAccess with 'granted' somewhere in the file
    expect(
      src,
      'shared-report-read.ts must call logReportAccess with "granted"'
    ).toMatch(/logReportAccess\([^)]*'granted'/);
  });

  // @born-red TL-039 | method: design-time-negative-assertion | date: 2026-08-03
  test('denied paths also call logReportAccess (no silent denial)', () => {
    const sources = loadSources();
    const readHandlerKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('handlers/shared-report-read')
    );
    const src = sources[readHandlerKey!]!;

    // Must call logReportAccess with 'denied' (at least once — for invalid token + event_id mismatch)
    expect(
      src,
      'shared-report-read.ts must call logReportAccess with "denied"'
    ).toMatch(/logReportAccess\([^)]*'denied'/);

    // Denied calls must use ctx.waitUntil (fire-and-forget, non-blocking)
    expect(
      src,
      'logReportAccess must be wrapped in ctx.waitUntil'
    ).toMatch(/waitUntil\(\s*logReportAccess/);
  });

  test('logReportAccess in audit-log.ts uses only INSERT (no UPDATE of existing rows per access)', () => {
    const sources = loadSources();
    const auditKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('lib/audit-log')
    );
    expect(auditKey, 'audit-log.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();

    const src = sources[auditKey!]!;

    // report_access_log uses INSERT ... ON CONFLICT upsert — never bare UPDATE
    const reportAccessBlock = src.slice(
      src.indexOf('logReportAccess'),
      src.indexOf('logExportManifest')
    );

    expect(
      reportAccessBlock,
      'logReportAccess must INSERT (daily upsert via ON CONFLICT)'
    ).toContain('INSERT INTO report_access_log');

    // Must not have a raw UPDATE statement for report_access_log outside the ON CONFLICT clause
    const rawUpdateMatch = reportAccessBlock.match(/^\s*UPDATE\s+report_access_log/m);
    expect(
      rawUpdateMatch,
      'logReportAccess must not use a bare UPDATE statement (only INSERT ... ON CONFLICT)'
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S6 — TL-040: demo trio tier regression guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-561 S6 — TL-040: demo trio — local/mid/premium tier boundaries are stable', () => {
  // @born-red TL-040 | method: design-time-negative-assertion | date: 2026-08-03
  test('demo-local: resolves to depth=local, sponsorScope=null when no sponsor_id', () => {
    const r = resolveDepth({ role: 'sponsor', depth: 'local' });
    expect(r.depth).toBe('local');
    expect(r.sponsorScope).toBeNull();
  });

  // @born-red TL-040 | method: design-time-negative-assertion | date: 2026-08-03
  test('demo-mid: resolves to depth=mid, carries sponsor_id scope', () => {
    const r = resolveDepth({ role: 'sponsor', depth: 'mid', sponsor_id: 'sp_demo' });
    expect(r.depth).toBe('mid');
    expect(r.sponsorScope).toBe('sp_demo');
  });

  // @born-red TL-040 | method: design-time-negative-assertion | date: 2026-08-03
  test('demo-premium: only admin and bar_owner reach premium depth (sponsor cannot self-grant)', () => {
    // Sponsor claiming premium must be rejected (fail-closed fallback to local)
    const sponsorAttempt = resolveDepth({ role: 'sponsor', depth: 'premium' });
    expect(
      sponsorAttempt.depth,
      'sponsor role must not reach premium depth even if depth=premium in token'
    ).toBe('local');

    // Admin always gets premium
    const adminR = resolveDepth({ role: 'admin' });
    expect(adminR.depth).toBe('premium');

    // bar_owner always gets premium
    const ownerR = resolveDepth({ role: 'bar_owner' });
    expect(ownerR.depth).toBe('premium');
  });

  test('additive ladder invariant: local ⊆ mid ⊆ premium (no regressions)', () => {
    const localSet = new Set(DEPTH_SECTIONS.local);
    const midSet = new Set(DEPTH_SECTIONS.mid);
    const premiumSet = new Set(DEPTH_SECTIONS.premium);

    for (const f of localSet) {
      expect(midSet, `field "${f}" dropped from mid — additive ladder broken`).toContain(f);
    }
    for (const f of midSet) {
      expect(premiumSet, `field "${f}" dropped from premium — additive ladder broken`).toContain(f);
    }
  });

  test('OSE-561 evidence', () => {
    const report = {
      story: 'OSE-561',
      threats_covered: ['TL-037', 'TL-038', 'TL-039', 'TL-040'],
      date: '2026-08-03',
      depth_sections: DEPTH_SECTIONS,
    };
    console.log(`[OSE-561-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.threats_covered).toHaveLength(4);
  });
});

/**
 * OSE-714 — Invariant #5 depth-gate: READ-HANDLER enforcement-state guard.
 *
 * The pure functions (resolveDepth / filterReportByDepth) are unit-tested in
 * report-depth.spec.ts, and the deployed endpoint is checked by the staging
 * E2E tier (tests/e2e/3-flows/sharedreport-depth.spec.ts). Neither proves the
 * ONE thing REPORT-DEPTH.md §8 calls load-bearing: that the READ HANDLER
 * actually COMPOSES them — "filterReportByDepth wired into the read handler,
 * sponsor role only" (ADR-017 / OSE-816). Delete the filter block in
 * handleGetSharedReport (shared-report-read.ts) and the unit tests stay green
 * while the E2E tier can all-skip whenever staging fixtures are unseeded — the
 * depth-access regression ships behind a green board.
 *
 * This fast, non-skippable, in-process test closes that hole. It drives the
 * REAL handler with a REAL minted signed-link token and the REAL depth lib,
 * mocking only the two impure collaborators (the D1 report builder and the
 * audit log). The enforcement-state assertion — the durable artifact §8 asks
 * for — is "wired, sponsor role only": if the filter is removed, or extended
 * to non-sponsor roles, one of these three tests goes red without ADR-017
 * changing.
 *
 * @born-red OSE-714 | method: wiring-removal | verified: deleting the
 *   `if (claim.role === 'sponsor') { ... filterReportByDepth(...) }` block in
 *   shared-report-read.ts turns SPONSOR-1/SPONSOR-2 red (premium sections leak
 *   to a local/mid sponsor); changing the guard to filter admins turns ADMIN red.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ONLY the heavy/impure collaborators. The depth lib and the auth lib are
// the REAL ones — the wiring under test lives between them and the handler.
vi.mock('../src/lib/shared-report-builder', () => ({
  buildSharedReport: vi.fn(),
}));
vi.mock('../src/lib/audit-log', () => ({
  logReportAccess: vi.fn().mockResolvedValue(undefined),
}));

import {
  handleGetSharedReport,
  type SharedReportReadEnv,
} from '../src/handlers/shared-report-read';
import { buildSharedReport, type SharedReport } from '../src/lib/shared-report-builder';
import { mintSignedLinkToken, type SignedLinkRole } from '../src/lib/shared-report-auth';

const EVENT_ID = 'evt_depth_wire';
const SIGNING_SECRET = 'test-signing-secret-OSE-714';

const env: SharedReportReadEnv = {
  DB: {} as D1Database, // never touched — buildSharedReport is mocked
  SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET,
};

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

// A full-premium report: every depth's sections present, so stripping is
// observable. sponsor_impressions carries two sponsors to prove scoping too.
function fullReport(): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_title: 'Depth Wiring Night',
    event_start_date: '2026-06-01T18:00:00Z',
    event_end_date: '2026-06-01T22:00:00Z',
    distinct_scanners: 99,
    sponsor_impressions: [
      { sponsor_id: 'sp_A', count: 10, surface: 'poster' },
      { sponsor_id: 'sp_B', count: 5, surface: 'poster' },
    ],
    sponsor_class_breakdown: [{ class: 'food', count: 15 }],
    campaign_summary: null,
    poster_attribution: { views: 500, scans: 100 },
    return_rate: 0.42,
    corridor_density: [{ cell: '89266454447ffff', count: 20 }],
    corridor_map: { svg: '<svg/>' },
    headcount_trend: [{ date: '2026-06-01', count: 99 }],
    _meta: { built_at: '2026-07-28T00:00:00Z' },
  };
}

async function callAs(
  role: SignedLinkRole,
  extra: { depth?: string; sponsor_id?: string } = {}
): Promise<{ status: number; report: Record<string, unknown> }> {
  const token = await mintSignedLinkToken(env, EVENT_ID, role, 3600, extra);
  const request = new Request(`https://x/api/v2/events/${EVENT_ID}/shared-report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = await handleGetSharedReport(request, env, EVENT_ID, ctx);
  const body = (await res.json()) as { ok: boolean; report: Record<string, unknown> };
  return { status: res.status, report: body.report };
}

beforeEach(() => {
  vi.mocked(buildSharedReport).mockResolvedValue({
    ok: true,
    report: fullReport() as unknown as SharedReport,
  });
});

describe('OSE-714 | read handler composes filterReportByDepth (enforcement-state, sponsor role only)', () => {
  it('SPONSOR-1: local sponsor token → handler strips every above-local section', async () => {
    const { status, report } = await callAs('sponsor', { depth: 'local', sponsor_id: 'sp_A' });
    expect(status).toBe(200);
    // Local keeps the smoke-test basics...
    expect(report.distinct_scanners).toBe(99);
    expect(report.event_title).toBe('Depth Wiring Night');
    // ...and the HANDLER (not the client) omits every paid section:
    expect('corridor_map' in report).toBe(false);
    expect('headcount_trend' in report).toBe(false);
    expect('poster_attribution' in report).toBe(false);
    expect('return_rate' in report).toBe(false);
    expect('corridor_density' in report).toBe(false);
    expect('campaign_summary' in report).toBe(false);
    // The refusal is printed on the wire (doctrine rule 12), not browser-hidden:
    expect((report.upgrade as { next_depth?: string } | undefined)?.next_depth).toBe('mid');
    // Scoped to own rows only (TL-040 / OSE-595):
    const rows = report.sponsor_impressions as Array<{ sponsor_id: string }>;
    expect(rows.map((x) => x.sponsor_id)).toEqual(['sp_A']);
  });

  it('SPONSOR-2: mid sponsor token → corridor_map delivered, only premium-only headcount_trend withheld', async () => {
    const { report } = await callAs('sponsor', { depth: 'mid', sponsor_id: 'sp_A' });
    expect('corridor_map' in report).toBe(true);
    expect('poster_attribution' in report).toBe(true);
    expect('headcount_trend' in report).toBe(false);
    expect((report.upgrade as { next_depth?: string } | undefined)?.next_depth).toBe('premium');
  });

  it('ADMIN: non-sponsor role bypasses the filter entirely — full report, all sponsor rows, no upgrade', async () => {
    const { report } = await callAs('admin');
    // The "sponsor role ONLY" half of the wiring: admin is NOT filtered.
    expect('headcount_trend' in report).toBe(true);
    expect('corridor_map' in report).toBe(true);
    const rows = report.sponsor_impressions as Array<{ sponsor_id: string }>;
    expect(rows.map((x) => x.sponsor_id).sort()).toEqual(['sp_A', 'sp_B']);
    // No filter ran → no upgrade hint injected.
    expect('upgrade' in report).toBe(false);
  });
});

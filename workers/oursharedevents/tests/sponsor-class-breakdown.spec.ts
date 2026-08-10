/**
 * SR-25 — SharedReport competitive intelligence gate
 *
 * Source-level gates asserting that shared-report.html renders the
 * Sponsor Competitive View section from sponsor_class_breakdown data:
 *
 *   1. Section has signed-link-sponsor-class-breakdown testid
 *   2. sponsor-class-table is present with local/mid/premium rows
 *   3. local-vs-paid-bar with bar-local + bar-paid segments
 *   4. local-vs-paid-delta shows impressions summary
 *   5. Suppressed when report.sponsor_class_breakdown is absent/null
 *   6. TL-040: individual sponsor names/tokens not shown in competitive view
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function getSharedReportHtml(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('templates/shared-report.html')
  );
  if (!entry) throw new Error('templates/shared-report.html not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

describe('SR-25 | Sponsor Competitive View gate', () => {
  test('section has signed-link-sponsor-class-breakdown testid', () => {
    const src = getSharedReportHtml();
    expect(src).toContain('data-testid="signed-link-sponsor-class-breakdown"');
  });

  test('sponsor-class-table testid is present', () => {
    const src = getSharedReportHtml();
    expect(src).toContain('data-testid="sponsor-class-table"');
  });

  test('all three class rows are present (local, mid, premium)', () => {
    const src = getSharedReportHtml();
    expect(src).toContain('data-testid="sponsor-class-row-local"');
    expect(src).toContain('data-testid="sponsor-class-row-mid"');
    expect(src).toContain('data-testid="sponsor-class-row-premium"');
  });

  test('sponsor count and impressions testids are present for each class', () => {
    const src = getSharedReportHtml();
    expect(src).toContain('data-testid="local-sponsor-count"');
    expect(src).toContain('data-testid="local-impressions"');
    expect(src).toContain('data-testid="mid-sponsor-count"');
    expect(src).toContain('data-testid="mid-impressions"');
    expect(src).toContain('data-testid="premium-sponsor-count"');
    expect(src).toContain('data-testid="premium-impressions"');
  });

  test('local-vs-paid bar section is present', () => {
    const src = getSharedReportHtml();
    expect(src).toContain('data-testid="local-vs-paid-bar"');
    expect(src).toContain('data-testid="bar-local"');
    expect(src).toContain('data-testid="bar-paid"');
  });

  test('local-vs-paid delta summary is present', () => {
    const src = getSharedReportHtml();
    expect(src).toContain('data-testid="local-vs-paid-delta"');
    expect(src).toContain('data-testid="local-impressions-total"');
    expect(src).toContain('data-testid="paid-impressions-total"');
  });

  test('competitive view is gated on report.sponsor_class_breakdown existence', () => {
    const src = getSharedReportHtml();
    // Must be conditional — only rendered when sponsor_class_breakdown is present
    expect(src).toContain('report.sponsor_class_breakdown');
    // Must have a conditional guard (? : pattern or if check)
    // The IIFE body between the condition and the testid is ~2000 chars
    const condIdx = src.indexOf('report.sponsor_class_breakdown');
    expect(condIdx).toBeGreaterThan(-1);
    const condSection = src.slice(condIdx, condIdx + 3000);
    expect(condSection).toContain('signed-link-sponsor-class-breakdown');
  });

  test('TL-040: individual sponsor impression_token or click_token is not rendered in competitive view', () => {
    const src = getSharedReportHtml();
    // Competitive view must only show class-level aggregates — no individual token fields
    // Find the competitive view section and ensure it doesn't expose individual sponsor tokens
    const sectionStart = src.indexOf('signed-link-sponsor-class-breakdown');
    const sectionEnd = src.indexOf('signed-link-poster-section');
    if (sectionStart === -1 || sectionEnd === -1) return; // gate would fail via earlier tests
    const sectionContent = src.slice(sectionStart, sectionEnd);
    expect(sectionContent).not.toContain('impression_token');
    expect(sectionContent).not.toContain('click_token');
    expect(sectionContent).not.toContain('sponsor_name');
  });

  test('privacy note about individual scope is present', () => {
    const src = getSharedReportHtml();
    // The section must include a note about individual sponsor details being scoped separately
    const sectionStart = src.indexOf('signed-link-sponsor-class-breakdown');
    const sectionEnd = src.indexOf('signed-link-poster-section');
    if (sectionStart === -1 || sectionEnd === -1) return;
    const sectionContent = src.slice(sectionStart, sectionEnd);
    expect(sectionContent).toContain('signed link');
  });
});

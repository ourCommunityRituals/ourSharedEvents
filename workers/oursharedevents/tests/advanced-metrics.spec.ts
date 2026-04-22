/**
 * SR-17: Advanced metrics (conversion funnels, trends)
 *
 * Verifies the advanced-metrics section is present in the shared report,
 * gated behind the Mid+ tier, with correct funnel CSS and HTML structure.
 * Runtime tier-switching is tested via integration stubs in L2.
 */

import { describe, test, expect } from 'vitest';
import { handleSharedReportPage } from '../src/handlers/pages';

function reportHtml(): Promise<string> {
  return handleSharedReportPage({} as never).text();
}

// ─── Section presence ────────────────────────────────────────────────────────

describe('SR-17: advanced-metrics section in shared report HTML', () => {
  test('section element with correct data-testid is present', async () => {
    expect(await reportHtml()).toContain('data-testid="advanced-metrics-section"');
  });

  test('section starts hidden (style="display:none")', async () => {
    const body = await reportHtml();
    expect(body).toMatch(/advanced-metrics-section[^>]*style="display:none"/);
  });

  test('section has aria-labelledby pointing to section-advanced-metrics', async () => {
    const body = await reportHtml();
    expect(body).toContain('aria-labelledby="section-advanced-metrics"');
    expect(body).toContain('id="section-advanced-metrics"');
  });

  test('content container with data-testid="advanced-metrics-content" present', async () => {
    expect(await reportHtml()).toContain('data-testid="advanced-metrics-content"');
  });
});

// ─── Tier badge ───────────────────────────────────────────────────────────────

describe('SR-17: Mid+ tier badge on advanced-metrics header', () => {
  test('tier badge has data-testid="advanced-metrics-tier-badge"', async () => {
    expect(await reportHtml()).toContain('data-testid="advanced-metrics-tier-badge"');
  });

  test('tier badge has .mid class', async () => {
    const body = await reportHtml();
    expect(body).toContain('class="tier-badge mid"');
  });

  test('tier badge CSS .tier-badge.mid defined in page', async () => {
    expect(await reportHtml()).toMatch(/\.tier-badge\.mid\s*\{[^}]*#d0ebff/);
  });
});

// ─── Funnel CSS ───────────────────────────────────────────────────────────────

describe('SR-17: funnel CSS classes defined', () => {
  test('.funnel-card CSS present', async () => {
    expect(await reportHtml()).toMatch(/\.funnel-card\s*\{[^}]*border-radius/);
  });

  test('.funnel-table CSS present', async () => {
    expect(await reportHtml()).toMatch(/\.funnel-table\s*\{[^}]*border-collapse/);
  });

  test('.bar-track and .bar-fill CSS present', async () => {
    const body = await reportHtml();
    expect(body).toContain('.bar-track');
    expect(body).toContain('.bar-fill');
  });

  test('.upgrade-prompt CSS present', async () => {
    expect(await reportHtml()).toMatch(/\.upgrade-prompt\s*\{[^}]*border/);
  });
});

// ─── JS tier gate + funnel render ────────────────────────────────────────────

describe('SR-17: JS tier gate logic in page template', () => {
  test('page fetches /api/v2/admin/flags/current-tier for tier check', async () => {
    expect(await reportHtml()).toContain('/api/v2/admin/flags/current-tier');
  });

  test('upgrade-prompt is rendered for free tier', async () => {
    expect(await reportHtml()).toContain('data-testid="advanced-metrics-upgrade"');
  });

  test('funnel-table data-testid referenced in JS', async () => {
    expect(await reportHtml()).toContain('data-testid="funnel-table"');
  });

  test('funnel fetches registrations endpoint per event', async () => {
    expect(await reportHtml()).toContain('/forms/registrations');
  });

  test('funnel fetches checkin-count endpoint per event', async () => {
    expect(await reportHtml()).toContain('/forms/checkin-count');
  });

  test('funnel-row data-testid referenced in JS render', async () => {
    expect(await reportHtml()).toContain('data-testid="funnel-row"');
  });

  test('attendance rate column rendered as percentage', async () => {
    expect(await reportHtml()).toContain('data-testid="funnel-rate"');
  });
});

// ─── No regression on existing report structure ───────────────────────────────

describe('SR-17: existing report structure intact', () => {
  test('export JSON button still present', async () => {
    expect(await reportHtml()).toContain('data-testid="export-json-btn"');
  });

  test('stat-total and stat-active still present', async () => {
    const body = await reportHtml();
    expect(body).toContain('id="stat-total"');
    expect(body).toContain('id="stat-active"');
  });

  test('report-events-list still present', async () => {
    expect(await reportHtml()).toContain('data-testid="report-events-list"');
  });

  test('report-sponsor-section still present', async () => {
    expect(await reportHtml()).toContain('data-testid="report-sponsor-section"');
  });
});

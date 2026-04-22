/**
 * SR-18: PDF export (mid tier)
 *
 * Verifies the Export PDF button is present in the shared report action bar,
 * starts disabled (Mid+ gate), and the page has correct @media print CSS
 * for clean PDF output.
 */

import { describe, test, expect } from 'vitest';
import { handleSharedReportPage } from '../src/handlers/pages';

function reportHtml(): Promise<string> {
  return handleSharedReportPage({} as never).text();
}

// ─── Button presence ──────────────────────────────────────────────────────────

describe('SR-18: Export PDF button in action bar', () => {
  test('export-pdf-btn present with correct data-testid', async () => {
    expect(await reportHtml()).toContain('data-testid="export-pdf-btn"');
  });

  test('export-pdf-btn starts disabled (Mid+ gate)', async () => {
    const body = await reportHtml();
    expect(body).toMatch(/id="export-pdf-btn"[^>]*disabled/);
  });

  test('export-pdf-btn has title attribute indicating tier requirement', async () => {
    const body = await reportHtml();
    expect(body).toContain('title="Mid+ plan required"');
  });

  test('export-pdf-btn is in the same action-bar as export-json-btn', async () => {
    const body = await reportHtml();
    const actionBarStart = body.indexOf('data-testid="report-action-bar"');
    const actionBarEnd = body.indexOf('</div>', actionBarStart);
    const actionBar = body.slice(actionBarStart, actionBarEnd);
    expect(actionBar).toContain('export-pdf-btn');
    expect(actionBar).toContain('export-json-btn');
  });
});

// ─── Tier gate JS ─────────────────────────────────────────────────────────────

describe('SR-18: tier gate — PDF button enabled only for Mid+', () => {
  test('JS enables export-pdf-btn when tier is not free', async () => {
    const body = await reportHtml();
    expect(body).toContain('export-pdf-btn');
    expect(body).toContain("tier !== 'free'");
  });

  test('JS wires export-pdf-btn click to window.print()', async () => {
    const body = await reportHtml();
    expect(body).toContain('export-pdf-btn');
    expect(body).toContain('window.print()');
  });
});

// ─── Print CSS ────────────────────────────────────────────────────────────────

describe('SR-18: @media print CSS for clean PDF output', () => {
  test('page has @media print block', async () => {
    expect(await reportHtml()).toContain('@media print');
  });

  test('action bar hidden in print view', async () => {
    const body = await reportHtml();
    expect(body).toMatch(/@media print[\s\S]*?\.action-bar[\s\S]*?display:\s*none/);
  });

  test('skip link hidden in print view', async () => {
    const body = await reportHtml();
    expect(body).toMatch(/@media print[\s\S]*?\.skip-link[\s\S]*?display:\s*none/);
  });

  test('advanced-metrics-section forced visible in print view', async () => {
    const body = await reportHtml();
    expect(body).toMatch(/@media print[\s\S]*?#advanced-metrics-section[\s\S]*?display:\s*block/);
  });

  test('print-color-adjust set for header color fidelity', async () => {
    expect(await reportHtml()).toContain('print-color-adjust: exact');
  });
});

// ─── No regression on existing report structure ───────────────────────────────

describe('SR-18: existing report features intact', () => {
  test('export-json-btn still present and disabled by default', async () => {
    const body = await reportHtml();
    expect(body).toContain('data-testid="export-json-btn"');
    expect(body).toMatch(/id="export-json-btn"[^>]*disabled/);
  });

  test('advanced-metrics section (SR-17) still present', async () => {
    expect(await reportHtml()).toContain('data-testid="advanced-metrics-section"');
  });

  test('skip link still present', async () => {
    expect(await reportHtml()).toContain('class="skip-link"');
  });
});

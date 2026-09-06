/**
 * OSE-636 | INT-04+05 — Poster Deployment Management UI gate
 *
 * Source-level gates asserting that admin.html contains all required elements
 * for the Poster Deployment Management card:
 *
 *   1. Card section with correct testid
 *   2. Form fields: placement_label, location_desc, latitude, longitude
 *   3. Create button and message element
 *   4. Panel with loading state
 *   5. loadPosterDeployments function wired to event list click
 *   6. deletePosterDeployment function
 *   7. API endpoints: GET list, POST create, DELETE
 *   8. Deployment table testids: row, label, h3-res9, qr-token, delete btn
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function getAdminTemplate(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('templates/admin.html')
  );
  if (!entry) throw new Error('admin.html not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

describe('OSE-636 | INT-04+05 | Poster Deployment Management UI gate', () => {
  test('card section has poster-deployments-card testid', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="poster-deployments-card"');
  });

  test('form has all required field testids', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="pd-placement-label"');
    expect(src).toContain('data-testid="pd-location-desc"');
    expect(src).toContain('data-testid="pd-latitude"');
    expect(src).toContain('data-testid="pd-longitude"');
  });

  test('form has create button and message testids', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="pd-create-btn"');
    expect(src).toContain('data-testid="pd-create-msg"');
  });

  test('panel has loading-initial state testid', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="poster-deployments-loading-initial"');
    expect(src).toContain('data-testid="poster-deployments-panel"');
  });

  test('form wrap has testid', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="poster-deployment-form-wrap"');
    expect(src).toContain('data-testid="poster-deployment-create-form"');
  });

  test('add deployment toggle button has testid', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="add-poster-deployment-toggle"');
  });

  test('loadPosterDeployments is defined and wired to the selection event (OSE-667)', () => {
    const src = getAdminTemplate();
    expect(src).toContain('window.loadPosterDeployments');
    // OSE-667: the four management cards fan out from the single
    // ose:event-selected event. (There may be >1 such listener — OSE-673's
    // context bar adds its own — so assert the poster wiring exists anywhere.)
    expect(src).toContain("addEventListener('ose:event-selected'");
    expect(src).toContain('window.loadPosterDeployments(d.id)');
    // The row gesture selects via the store. OSE-1239: through a data-action
    // the delegated dispatcher resolves, not an inline onclick the CSP refused.
    expect(src).toContain('data-action="event-select"');
  });

  test('deletePosterDeployment function is defined', () => {
    const src = getAdminTemplate();
    expect(src).toContain('window.deletePosterDeployment');
    expect(src).toContain("method: 'DELETE'");
  });

  test('GET list endpoint is called with correct path pattern', () => {
    const src = getAdminTemplate();
    expect(src).toContain('/api/v2/admin/events/');
    expect(src).toContain('/poster-deployments');
  });

  test('POST create endpoint is called with POST method', () => {
    const src = getAdminTemplate();
    expect(src).toContain("method: 'POST'");
    expect(src).toMatch(/\/api\/v2\/admin\/events\/.*\/poster-deployments/);
  });

  test('deployment table row testids are present in template', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="poster-deployment-row"');
    expect(src).toContain('data-testid="pd-label"');
    expect(src).toContain('data-testid="pd-h3-res9"');
    expect(src).toContain('data-testid="pd-qr-token"');
    expect(src).toContain('data-testid="pd-delete-btn"');
  });

  test('deployment table has h3_res9 column', () => {
    const src = getAdminTemplate();
    expect(src).toContain('pd.h3_res9');
    expect(src).toContain('Cell (res9)');
  });

  // ── OSE-895: GAS QRRegenerator frame → .qr-card grid (functional slice) ──────
  test('OSE-895: deployments render as the .qr-card frame, not a report-table', () => {
    const src = getAdminTemplate();
    // The canonical frame from OSE-887 (poster.html) is reused here.
    expect(src).toContain('class="qr-card pd-qr-card"');
    expect(src).toContain('class="pd-qr-grid"');
    expect(src).toContain('class="qr-card-header"');
    expect(src).toContain('class="qr-card-body"');
    expect(src).toContain('class="qr-card-footer"');
  });

  test('OSE-895: each card renders the scannable QR image with a testid', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="pd-qr-img"');
    // The image source is the server-supplied data-URI, not an external QR API.
    expect(src).toContain('pd.qr_data_uri');
    expect(src).not.toContain('chart.googleapis.com');
  });

  test('OSE-895: Download and Print actions are wired', () => {
    const src = getAdminTemplate();
    expect(src).toContain('data-testid="pd-download-btn"');
    expect(src).toContain('data-testid="pd-print-btn"');
    expect(src).toContain('window.downloadPosterQr');
    expect(src).toContain('window.printPosterQr');
  });

  test('OSE-895: existing deployment testids are preserved on the card frame', () => {
    const src = getAdminTemplate();
    // Card carries the same row/label/cell/token/delete testids the prior
    // table did, so downstream selectors and the two-step delete still resolve.
    expect(src).toContain('data-testid="poster-deployment-row"');
    expect(src).toContain('data-testid="pd-label"');
    expect(src).toContain('data-testid="pd-location"');
    expect(src).toContain('data-testid="pd-h3-res9"');
    expect(src).toContain('data-testid="pd-qr-token"');
    expect(src).toContain('data-testid="pd-delete-btn"');
  });
});
